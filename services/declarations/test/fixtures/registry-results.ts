import type {
  ArdhisasaResult,
  BrsResult,
  KraResult,
  NtsaResult,
  RegistrySystem,
} from '../../src/suggestions/registry-results.js';

/**
 * Uniform verification results as the integration-gateway returns them (spec 05b, S3), per
 * registry: a full record, an empty result, a partial record, and the not-found and unavailable
 * outcomes. Synthetic data only.
 */

const CHECKED_AT = '2026-09-20T08:30:00.000Z';

function envelope<TSystem extends RegistrySystem>(system: TSystem, resultId: string) {
  return {
    resultId,
    system,
    outcome: 'found' as const,
    reason: null,
    cached: false,
    checkedAt: CHECKED_AT,
  };
}

export const ntsa = {
  found: {
    ...envelope('ntsa', '6f1d2a8e-0b1c-4c55-9c1e-2f0a3b4c5d01'),
    vehicles: [
      {
        registrationNumber: 'KCA 123A',
        make: 'Toyota',
        model: 'Fielder',
        yearOfManufacture: 2016,
        registeredOn: '2019-03-14',
      },
      {
        registrationNumber: 'KDA 456X',
        make: 'Isuzu',
        model: 'D-Max',
        yearOfManufacture: 2021,
        registeredOn: '2022-01-05',
      },
    ],
  },
  empty: { ...envelope('ntsa', '6f1d2a8e-0b1c-4c55-9c1e-2f0a3b4c5d02'), vehicles: [] },
  partial: {
    ...envelope('ntsa', '6f1d2a8e-0b1c-4c55-9c1e-2f0a3b4c5d03'),
    vehicles: [
      // Make and model blank, year unknown (0): registration only.
      {
        registrationNumber: ' kbz 789c ',
        make: '',
        model: ' ',
        yearOfManufacture: 0,
        registeredOn: '',
      },
      // No identifier and nothing descriptive: not suggested.
      { registrationNumber: '', make: '', model: '', yearOfManufacture: 2010, registeredOn: '' },
    ],
  },
  notFound: {
    ...envelope('ntsa', '6f1d2a8e-0b1c-4c55-9c1e-2f0a3b4c5d04'),
    outcome: 'not-found',
    vehicles: [],
  },
  unavailable: {
    ...envelope('ntsa', '6f1d2a8e-0b1c-4c55-9c1e-2f0a3b4c5d05'),
    outcome: 'unavailable',
    reason: 'breaker-open',
    vehicles: [],
  },
} satisfies Record<string, NtsaResult>;

export const ardhisasa = {
  found: {
    ...envelope('ardhisasa', '7a2e3b9f-1c2d-4d66-8d2f-3a1b4c5d6e01'),
    parcels: [
      {
        parcelNumber: 'Uasin Gishu/Kimumu/2231',
        county: 'Uasin Gishu',
        areaHectares: 0.2,
        tenure: 'freehold',
        registeredOn: '2015-06-30',
      },
      {
        parcelNumber: 'Nairobi/Block 82/1234',
        county: 'Nairobi City',
        areaHectares: 0.045,
        tenure: 'leasehold',
        registeredOn: '2020-11-02',
      },
    ],
  },
  empty: { ...envelope('ardhisasa', '7a2e3b9f-1c2d-4d66-8d2f-3a1b4c5d6e02'), parcels: [] },
  partial: {
    ...envelope('ardhisasa', '7a2e3b9f-1c2d-4d66-8d2f-3a1b4c5d6e03'),
    parcels: [
      // County as a code, size unknown, tenure blank.
      {
        parcelNumber: 'Kajiado/Kitengela/5512',
        county: '034',
        areaHectares: 0,
        tenure: '',
        registeredOn: '2018-02-01',
      },
      // County the Constitution does not list: kept as free-text location.
      {
        parcelNumber: 'LR 209/1234',
        county: 'Coast Province',
        areaHectares: 1.25,
        tenure: 'leasehold',
        registeredOn: '1998-07-15',
      },
      // No parcel number: not suggested.
      {
        parcelNumber: '  ',
        county: 'Nakuru',
        areaHectares: 2,
        tenure: 'freehold',
        registeredOn: '2001-01-01',
      },
    ],
  },
  unavailable: {
    ...envelope('ardhisasa', '7a2e3b9f-1c2d-4d66-8d2f-3a1b4c5d6e04'),
    outcome: 'unavailable',
    reason: 'paused',
    parcels: [],
  },
} satisfies Record<string, ArdhisasaResult>;

export const brs = {
  found: {
    ...envelope('brs', '8b3f4c0a-2d3e-4e77-9e3a-4b2c5d6e7f01'),
    directorships: [
      {
        companyRegistrationNumber: 'PVT-AB12CD3E',
        companyName: 'Rift Valley Agrovet Ltd',
        companyStatus: 'registered',
        role: 'Shareholder',
        shares: 500,
        appointedOn: '2017-04-10',
      },
      {
        companyRegistrationNumber: 'PVT-XY98ZW7Q',
        companyName: 'Kimumu Transporters Limited',
        companyStatus: 'registered',
        role: 'Director',
        shares: null,
        appointedOn: '2021-09-01',
      },
    ],
  },
  empty: { ...envelope('brs', '8b3f4c0a-2d3e-4e77-9e3a-4b2c5d6e7f02'), directorships: [] },
  partial: {
    ...envelope('brs', '8b3f4c0a-2d3e-4e77-9e3a-4b2c5d6e7f03'),
    directorships: [
      // Name missing: described by the registration number.
      {
        companyRegistrationNumber: 'CPR/2009/12345',
        companyName: '',
        companyStatus: '',
        role: '',
        shares: 0,
        appointedOn: '',
      },
      // Neither name nor number: not suggested.
      {
        companyRegistrationNumber: '',
        companyName: ' ',
        companyStatus: 'dissolved',
        role: 'Director',
        shares: 10,
        appointedOn: '2010-01-01',
      },
    ],
  },
  notFound: {
    ...envelope('brs', '8b3f4c0a-2d3e-4e77-9e3a-4b2c5d6e7f04'),
    outcome: 'not-found',
    directorships: [],
  },
} satisfies Record<string, BrsResult>;

export const kra = {
  found: {
    ...envelope('kra', '9c4a5d1b-3e4f-4f88-8f4b-5c3d6e7f8a01'),
    taxpayers: [
      {
        pin: 'A005231876K',
        registeredOn: '2012-08-20',
        compliance: {
          status: 'compliant',
          certificateNumber: 'KRATCC2026-000123',
          validUntil: '2027-03-31',
          annualIncomeDeclaredCents: 142_800_000,
        },
      },
    ],
  },
  empty: { ...envelope('kra', '9c4a5d1b-3e4f-4f88-8f4b-5c3d6e7f8a02'), taxpayers: [] },
  partial: {
    ...envelope('kra', '9c4a5d1b-3e4f-4f88-8f4b-5c3d6e7f8a03'),
    taxpayers: [
      // No certificate, no validity and no income data.
      {
        pin: 'a006612874m',
        registeredOn: '2016-01-11',
        compliance: {
          status: 'unknown',
          certificateNumber: null,
          validUntil: null,
          annualIncomeDeclaredCents: null,
        },
      },
      // Blank PIN: not suggested.
      {
        pin: '',
        registeredOn: '',
        compliance: {
          status: 'non-compliant',
          certificateNumber: null,
          validUntil: null,
          annualIncomeDeclaredCents: 1_000,
        },
      },
    ],
  },
  unavailable: {
    ...envelope('kra', '9c4a5d1b-3e4f-4f88-8f4b-5c3d6e7f8a04'),
    outcome: 'unavailable',
    reason: 'timeout',
    taxpayers: [],
  },
} satisfies Record<string, KraResult>;
