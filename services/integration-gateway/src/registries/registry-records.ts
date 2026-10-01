import { z } from 'zod';

import { LOOKUP_OUTCOMES, SYSTEMS, UNAVAILABLE_REASONS } from '../db/schema.js';

// Normalised answers: what the kit caches, encrypts on the result row and the lookup returns.

export const KRA_COMPLIANCE_STATUSES = ['compliant', 'non-compliant', 'unknown'] as const;

export const kraTaxpayerSchema = z.object({
  pin: z.string(),
  registeredOn: z.iso.date(),
  compliance: z.object({
    status: z.enum(KRA_COMPLIANCE_STATUSES),
    certificateNumber: z.string().nullable(),
    validUntil: z.iso.date().nullable(),
    /** KES cents, as every amount on the platform. */
    annualIncomeDeclaredCents: z.int().nullable(),
  }),
});
/** KRA's PINs for a national ID, each with its compliance. Not found: no PIN at all. */
export const kraTaxpayersSchema = z.object({ taxpayers: z.array(kraTaxpayerSchema) });
export type KraTaxpayers = z.infer<typeof kraTaxpayersSchema>;

export const ntsaVehicleSchema = z.object({
  registrationNumber: z.string(),
  make: z.string(),
  model: z.string(),
  yearOfManufacture: z.int(),
  registeredOn: z.iso.date(),
});
/** Vehicles registered to a national ID; none is a found answer with no vehicles. */
export const ntsaVehiclesSchema = z.object({ vehicles: z.array(ntsaVehicleSchema) });
export type NtsaVehicles = z.infer<typeof ntsaVehiclesSchema>;

export const brsDirectorshipSchema = z.object({
  companyRegistrationNumber: z.string(),
  companyName: z.string(),
  /** `active` or `dissolved` in BRS today; kept open as BRS may add statuses. */
  companyStatus: z.string(),
  /** `director`, `shareholder` or `director_shareholder` in BRS today. */
  role: z.string(),
  shares: z.int().nullable(),
  appointedOn: z.iso.date(),
});
/** Directorships and shareholdings of a national ID; none is a found answer. */
export const brsDirectorshipsSchema = z.object({ directorships: z.array(brsDirectorshipSchema) });
export type BrsDirectorships = z.infer<typeof brsDirectorshipsSchema>;

export const ardhisasaParcelSchema = z.object({
  parcelNumber: z.string(),
  county: z.string(),
  areaHectares: z.number(),
  /** `freehold` or `leasehold` in ArdhiSasa today. */
  tenure: z.string(),
  registeredOn: z.iso.date(),
});
/** Parcels registered to a national ID; none is a found answer. */
export const ardhisasaParcelsSchema = z.object({ parcels: z.array(ardhisasaParcelSchema) });
export type ArdhisasaParcels = z.infer<typeof ardhisasaParcelsSchema>;

/** Whether a company is on an employer's supplier list (HR). */
export const supplierAnswerSchema = z.object({ supplies: z.boolean() });
export type SupplierAnswer = z.infer<typeof supplierAnswerSchema>;

// The registries' own shapes (packages/schemas/external), transformed to ours. Unused fields
// (names, owner IDs) are dropped here, so they are never cached or stored.

/** `annual_income_declared`, a decimal string of shillings, in cents without float rounding. */
function shillingsToCents(value: string): number {
  const match = /^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error('Not a decimal amount');
  const [, sign, shillings = '0', cents = ''] = match;
  const total = Number(shillings) * 100 + Number(cents.padEnd(2, '0'));
  return sign === '-' ? -total : total;
}

const decimal = (pattern: RegExp) => z.string().regex(pattern);

/** external/kra.yaml `findTaxpayersByIdNumber`. */
export const kraPinsSchema = z.array(
  z.object({ pin: z.string().min(1), registered_on: z.iso.date() }),
);

/** external/kra.yaml `Compliance`. The mock writes `non_compliant`; we write `non-compliant`. */
export const kraComplianceSchema = z
  .object({
    status: z.string(),
    certificate_number: z.string().nullish(),
    valid_until: z.iso.date().nullish(),
    annual_income_declared: decimal(/^-?\d{1,12}(?:\.\d{1,2})?$/).nullish(),
  })
  .transform((compliance) => ({
    status: complianceStatus(compliance.status),
    certificateNumber: compliance.certificate_number?.trim() ? compliance.certificate_number : null,
    validUntil: compliance.valid_until ?? null,
    annualIncomeDeclaredCents:
      compliance.annual_income_declared == null
        ? null
        : shillingsToCents(compliance.annual_income_declared),
  }));

function complianceStatus(status: string): (typeof KRA_COMPLIANCE_STATUSES)[number] {
  const normalised = status
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  return normalised === 'compliant' || normalised === 'non-compliant' ? normalised : 'unknown';
}

/** external/ntsa.yaml `listVehiclesByOwner`. */
export const ntsaOwnerVehiclesSchema = z
  .array(
    z.object({
      registration_number: z.string().min(1),
      make: z.string(),
      model: z.string(),
      year_of_manufacture: z.int(),
      registered_on: z.iso.date(),
    }),
  )
  .transform((vehicles): NtsaVehicles => ({
    vehicles: vehicles.map((vehicle) => ({
      registrationNumber: vehicle.registration_number,
      make: vehicle.make,
      model: vehicle.model,
      yearOfManufacture: vehicle.year_of_manufacture,
      registeredOn: vehicle.registered_on,
    })),
  }));

/** external/brs.yaml `listDirectorshipsByPerson`. */
export const brsPersonDirectorshipsSchema = z
  .array(
    z.object({
      company_registration_number: z.string().min(1),
      company_name: z.string(),
      company_status: z.string(),
      role: z.string(),
      shares: z.int().nullish(),
      appointed_on: z.iso.date(),
    }),
  )
  .transform((directorships): BrsDirectorships => ({
    directorships: directorships.map((directorship) => ({
      companyRegistrationNumber: directorship.company_registration_number,
      companyName: directorship.company_name,
      companyStatus: directorship.company_status,
      role: directorship.role,
      shares: directorship.shares ?? null,
      appointedOn: directorship.appointed_on,
    })),
  }));

/** external/ardhisasa.yaml `listParcelsByOwner`. */
export const ardhisasaOwnerParcelsSchema = z
  .array(
    z.object({
      parcel_number: z.string().min(1),
      county: z.string(),
      area_hectares: decimal(/^\d{1,6}(?:\.\d{1,4})?$/),
      tenure: z.string(),
      registered_on: z.iso.date(),
    }),
  )
  .transform((parcels): ArdhisasaParcels => ({
    parcels: parcels.map((parcel) => ({
      parcelNumber: parcel.parcel_number,
      county: parcel.county,
      areaHectares: Number(parcel.area_hectares),
      tenure: parcel.tenure,
      registeredOn: parcel.registered_on,
    })),
  }));

/** external/hr.yaml `listSuppliersByEmployer`. */
export const hrEmployerSuppliersSchema = z.object({
  registration_numbers: z.array(z.string()),
});

// The internal API (packages/schemas/internal/integration-gateway.yaml).

export const NATIONAL_ID = /^[0-9]{5,10}$/;

/** Body of every registry lookup by national ID (`RegistryLookup`). */
export const registryLookupSchema = z
  .strictObject({ nationalId: z.string().regex(NATIONAL_ID, 'must be 5 to 10 digits') })
  .meta({ description: 'Whom to look up' });
export type RegistryLookup = z.infer<typeof registryLookupSchema>;

/** A company registration number as BRS writes them, e.g. `PVT-9XYZ2L4Q`. */
export const REGISTRATION_NUMBER = /^[A-Za-z0-9][A-Za-z0-9/-]{0,39}$/;
/** An employer code as HR writes them, e.g. `KEMSA`. */
export const EMPLOYER_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
export const registrationNumberSchema = z
  .string()
  .regex(REGISTRATION_NUMBER, 'must be a company registration number');
export const employerCodeSchema = z.string().regex(EMPLOYER_CODE, 'must be an employer code');

export const systemSchema = z.enum(SYSTEMS);
export const lookupOutcomeSchema = z.enum(LOOKUP_OUTCOMES);
export const unavailableReasonSchema = z.enum(UNAVAILABLE_REASONS).meta({
  description:
    'rate-limited when no slot of the system rate limit freed up within the max queue wait, or the registry refused the call for its own',
});

export const resultEnvelopeSchema = z.object({
  /** The verification-results row: every answered lookup is recorded. */
  resultId: z.uuid(),
  system: systemSchema,
  outcome: lookupOutcomeSchema,
  reason: unavailableReasonSchema.nullable(),
  cached: z.boolean(),
  checkedAt: z.iso.datetime({ offset: true }),
});
export type ResultEnvelope = z.infer<typeof resultEnvelopeSchema>;

const describedResult = (description: string) => ({ description });

export const kraResultSchema = resultEnvelopeSchema
  .extend(kraTaxpayersSchema.shape)
  .meta(
    describedResult(
      'KRA PINs with their compliance. not-found: no PIN for the national ID. taxpayers is empty unless found.',
    ),
  );
export const ntsaResultSchema = resultEnvelopeSchema
  .extend(ntsaVehiclesSchema.shape)
  .meta(describedResult('Vehicles registered to the national ID; empty unless found.'));
export const brsResultSchema = resultEnvelopeSchema
  .extend(brsDirectorshipsSchema.shape)
  .meta(describedResult('Directorships and shareholdings of the national ID; empty unless found.'));
export const ardhisasaResultSchema = resultEnvelopeSchema
  .extend(ardhisasaParcelsSchema.shape)
  .meta(describedResult('Land parcels registered to the national ID; empty unless found.'));
export const supplierCheckResultSchema = resultEnvelopeSchema
  .extend({ supplies: z.boolean().nullable() })
  .meta(
    describedResult(
      "Whether the company is on the employer's supplier list (HR). null when unavailable.",
    ),
  );

export const storedResultSchema = z
  .object({
    resultId: z.uuid(),
    system: systemSchema,
    outcome: lookupOutcomeSchema,
    checkedAt: z.iso.datetime({ offset: true }),
    legalBasis: z.string(),
    caseRef: z.string().nullable(),
    payload: z.record(z.string(), z.unknown()).nullable().meta({
      description:
        'The normalised records the lookup answered (e.g. { vehicles: [...] }); null unless the outcome is found',
    }),
  })
  .meta({ description: 'A stored lookup result, decrypted for a service of its tenant' });
