import { z } from 'zod';

import type {
  LookupSystem,
  RegistryResults,
  StoredResult,
  SupplierCheckResult,
} from './integration-gateway-client.js';

/**
 * The integration-gateway's registry answers as integration-gateway.yaml has them, checked before
 * use: the generated types describe the contract, not what arrived.
 */

const outcome = z.enum(['found', 'not-found', 'unavailable']);
const system = z.enum([
  'iprs',
  'kra',
  'ntsa',
  'brs',
  'ardhisasa',
  'hr-suppliers',
  'payroll',
  'icms',
]);
const isoDate = z.iso.date();

/** `ResultEnvelope`. */
const envelope = z.object({
  resultId: z.uuid(),
  system,
  outcome,
  reason: z
    .enum(['timeout', 'breaker-open', 'paused', 'rate-limited', 'upstream-error'])
    .nullable(),
  cached: z.boolean(),
  checkedAt: z.iso.datetime({ offset: true }),
});

/** The records of each registry's lookup, as the answer carries them and the gateway stores them. */
export const REGISTRY_RECORDS = {
  kra: z.object({
    taxpayers: z.array(
      z.object({
        pin: z.string(),
        registeredOn: isoDate,
        compliance: z.object({
          status: z.enum(['compliant', 'non-compliant', 'unknown']),
          certificateNumber: z.string().nullable(),
          validUntil: isoDate.nullable(),
          annualIncomeDeclaredCents: z.int().nullable(),
        }),
      }),
    ),
  }),
  ntsa: z.object({
    vehicles: z.array(
      z.object({
        registrationNumber: z.string(),
        make: z.string(),
        model: z.string(),
        yearOfManufacture: z.int(),
        registeredOn: isoDate,
      }),
    ),
  }),
  brs: z.object({
    directorships: z.array(
      z.object({
        companyRegistrationNumber: z.string(),
        companyName: z.string(),
        companyStatus: z.string(),
        role: z.string(),
        shares: z.int().nullable(),
        appointedOn: isoDate,
      }),
    ),
  }),
  ardhisasa: z.object({
    parcels: z.array(
      z.object({
        parcelNumber: z.string(),
        county: z.string(),
        areaHectares: z.number(),
        tenure: z.string(),
        registeredOn: isoDate,
      }),
    ),
  }),
} as const satisfies Record<LookupSystem, z.ZodType>;

/** A lookup's answer: the envelope and the registry's records (`KraResult` and so on). */
export function lookupResultSchema<S extends LookupSystem>(
  lookup: S,
): z.ZodType<RegistryResults[S]> {
  return envelope.extend(REGISTRY_RECORDS[lookup].shape) as unknown as z.ZodType<
    RegistryResults[S]
  >;
}

/** `SupplierCheckResult`. */
export const supplierCheckSchema: z.ZodType<SupplierCheckResult> = envelope.extend({
  supplies: z.boolean().nullable(),
});

/** `StoredResult`; its payload is checked against `REGISTRY_RECORDS` where it is used. */
export const storedResultSchema: z.ZodType<StoredResult> = z.object({
  resultId: z.uuid(),
  system,
  outcome,
  checkedAt: z.iso.datetime({ offset: true }),
  legalBasis: z.string(),
  caseRef: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
});
