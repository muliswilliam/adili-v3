import type {
  ArdhisasaResult,
  BrsResult,
  KraResult,
  NtsaResult,
  SupplierCheckResult,
} from '../../src/rules/index.js';

/**
 * Registry lookups as the integration-gateway answers them for the planted demo records
 * (mocks/demo/seed.py, mocks/demo/REGISTRY_FLAGS.md), so the demo and the tests agree. Amounts
 * are the seed's KES amounts in cents.
 */

const CHECKED_AT = '2027-11-15T08:00:00.000Z';
let sequence = 0;
const resultId = () => `0192f1a0-7e57-7000-8000-${String((sequence += 1)).padStart(12, '0')}`;

function envelope<S extends string>(system: S, outcome: 'found' | 'not-found' = 'found') {
  return {
    resultId: resultId(),
    system,
    outcome,
    reason: null,
    cached: false,
    checkedAt: CHECKED_AT,
  };
}

export function kraResult(
  taxpayers: {
    pin: string;
    status?: 'compliant' | 'non-compliant' | 'unknown';
    annualIncomeKes: number | null;
  }[],
): KraResult {
  return {
    ...envelope('kra', taxpayers.length > 0 ? 'found' : 'not-found'),
    taxpayers: taxpayers.map(({ pin, status = 'compliant', annualIncomeKes }) => ({
      pin,
      registeredOn: '2006-03-01',
      compliance: {
        status,
        certificateNumber: status === 'compliant' ? `TCC${pin}` : null,
        validUntil: status === 'compliant' ? '2027-06-30' : null,
        annualIncomeDeclaredCents: annualIncomeKes === null ? null : annualIncomeKes * 100,
      },
    })),
  };
}

export function ntsaResult(
  vehicles: [registration: string, make: string, model: string, year: number, on: string][],
): NtsaResult {
  return {
    ...envelope('ntsa'),
    vehicles: vehicles.map(
      ([registrationNumber, make, model, yearOfManufacture, registeredOn]) => ({
        registrationNumber,
        make,
        model,
        yearOfManufacture,
        registeredOn,
      }),
    ),
  };
}

export function brsResult(
  directorships: [
    registration: string,
    name: string,
    status: string,
    role: string,
    shares: number,
    on: string,
  ][],
): BrsResult {
  return {
    ...envelope('brs'),
    directorships: directorships.map(
      ([companyRegistrationNumber, companyName, companyStatus, role, shares, appointedOn]) => ({
        companyRegistrationNumber,
        companyName,
        companyStatus,
        role,
        shares,
        appointedOn,
      }),
    ),
  };
}

export function ardhisasaResult(
  parcels: [parcelNumber: string, county: string, hectares: number, tenure: string, on: string][],
): ArdhisasaResult {
  return {
    ...envelope('ardhisasa'),
    parcels: parcels.map(([parcelNumber, county, areaHectares, tenure, registeredOn]) => ({
      parcelNumber,
      county,
      areaHectares,
      tenure,
      registeredOn,
    })),
  };
}

export function supplierCheck(supplies: boolean): SupplierCheckResult {
  return { ...envelope('brs'), supplies };
}

const AFYA_BORA = 'Afya Bora Medical Supplies Limited';
const RIFT_VALLEY_AGROVET = 'Rift Valley Agrovet Limited';

/** A seeded person: their national ID and every registry's answer for it. */
export interface SeededPerson {
  nationalId: string;
  results: () => { kra: KraResult; ntsa: NtsaResult; brs: BrsResult; ardhisasa: ArdhisasaResult };
}

const nothingButIprs = (nationalId: string): SeededPerson => ({
  nationalId,
  results: () => ({
    kra: kraResult([]),
    ntsa: ntsaResult([]),
    brs: brsResult([]),
    ardhisasa: ardhisasaResult([]),
  }),
});

/** Declarant at KEMSA: an undeclared Prado and Kajiado parcel, a director of a KEMSA supplier. */
export const WANJIKU: SeededPerson = {
  nationalId: '27451863',
  results: () => ({
    kra: kraResult([{ pin: 'A004518637K', annualIncomeKes: 3_120_000 }]),
    ntsa: ntsaResult([
      ['KCX 214J', 'Toyota', 'Fielder', 2016, '2019-05-12'],
      ['KDK 482M', 'Toyota', 'Land Cruiser Prado', 2023, '2024-11-04'],
    ]),
    brs: brsResult([
      ['PVT-9XYZ2L4Q', AFYA_BORA, 'active', 'director_shareholder', 400, '2022-02-14'],
    ]),
    ardhisasa: ardhisasaResult([
      ['KIAMBU/RUIRU EAST BLOCK 2/4417', 'Kiambu', 0.045, 'freehold', '2014-09-03'],
      ['KAJIADO/KITENGELA/59821', 'Kajiado', 2.0235, 'freehold', '2025-01-17'],
    ]),
  }),
};

/** Wanjiku's spouse: a Mazda and 600 shares in the same company; no public employment. */
export const PETER: SeededPerson = {
  nationalId: '24718355',
  results: () => ({
    kra: kraResult([{ pin: 'A002471835M', annualIncomeKes: 1_860_000 }]),
    ntsa: ntsaResult([['KCB 903T', 'Mazda', 'CX-5', 2014, '2017-02-20']]),
    brs: brsResult([
      ['PVT-9XYZ2L4Q', AFYA_BORA, 'active', 'director_shareholder', 600, '2022-02-14'],
    ]),
    ardhisasa: ardhisasaResult([]),
  }),
};

/** Wanjiku's children: IPRS only, so no registry flags. */
export const IMANI = nothingButIprs('40731125');
export const BARAKA = nothingButIprs('40731126');

/** Declarant at PSC: not tax compliant; a vehicle, a parcel and shares in an agrovet. */
export const KIPRONO: SeededPerson = {
  nationalId: '22607781',
  results: () => ({
    kra: kraResult([{ pin: 'A002260778R', status: 'non-compliant', annualIncomeKes: 2_640_000 }]),
    ntsa: ntsaResult([['KDA 118Q', 'Nissan', 'X-Trail', 2019, '2021-07-30']]),
    brs: brsResult([
      ['PVT-3KLM8R2T', RIFT_VALLEY_AGROVET, 'active', 'shareholder', 250, '2015-08-03'],
    ]),
    ardhisasa: ardhisasaResult([
      ['NAIROBI/BLOCK 82/1934', 'Nairobi', 0.093, 'leasehold', '2010-06-11'],
    ]),
  }),
};

/** Clean declarant: KRA compliant and nothing else, so empty lists are matches. */
export const AMINA: SeededPerson = {
  nationalId: '31552094',
  results: () => ({
    ...nothingButIprs('31552094').results(),
    kra: kraResult([{ pin: 'A003155209S', annualIncomeKes: 1_680_000 }]),
  }),
};

/** HR mock supplier lists: Afya Bora supplies KEMSA; the agrovet supplies nobody. */
export const KEMSA_SUPPLIERS = () => ({ 'PVT-9XYZ2L4Q': supplierCheck(true) });
export const PSC_SUPPLIERS = () => ({ 'PVT-3KLM8R2T': supplierCheck(false) });
