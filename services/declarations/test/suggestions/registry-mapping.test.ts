import type { PersonKey } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import {
  countyCode,
  type MappedSuggestion,
  mapRegistryResult,
} from '../../src/suggestions/registry-mapping.js';
import type { RegistryResult } from '../../src/suggestions/registry-results.js';
import { ardhisasa, brs, kra, ntsa } from '../fixtures/registry-results.js';

const SPOUSE = 'spouse:3f0c1b2a-4d5e-4f60-8a7b-9c0d1e2f3a4b' as const;
const CHILD = 'child:5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d' as const;

/** The suggestions a result yields for a person (the set around them is asserted once). */
function suggest(result: RegistryResult, personKey: PersonKey) {
  return mapRegistryResult(result, personKey).suggestions;
}

/** No suggestion ever carries a value: valuing is the declarant's (S3). */
function expectNoValues(suggestions: MappedSuggestion[]) {
  for (const { fields } of suggestions) {
    expect(Object.keys(fields)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(value|amount|outstanding)$/)]),
    );
  }
}

describe('NTSA → vehicle', () => {
  it('maps each vehicle to a vehicle asset in the person’s statement', () => {
    const suggestions = suggest(ntsa.found, 'officer');

    expect(suggestions).toEqual([
      {
        sectionKey: 'statement:officer',
        itemType: 'vehicle',
        fields: {
          description: 'Toyota Fielder',
          registration: 'KCA 123A',
          make: 'Toyota',
          model: 'Fielder',
          year: 2016,
        },
        sourceRef: { registration: 'KCA 123A', registeredOn: '2019-03-14' },
        matchKeys: ['registration:KCA123A'],
      },
      {
        sectionKey: 'statement:officer',
        itemType: 'vehicle',
        fields: {
          description: 'Isuzu D-Max',
          registration: 'KDA 456X',
          make: 'Isuzu',
          model: 'D-Max',
          year: 2021,
        },
        sourceRef: { registration: 'KDA 456X', registeredOn: '2022-01-05' },
        matchKeys: ['registration:KDA456X'],
      },
    ]);
    expectNoValues(suggestions);
  });

  it('suggests nothing for an empty result', () => {
    expect(suggest(ntsa.empty, 'officer')).toEqual([]);
  });

  it('leaves blank fields out of a partial record and skips any without a registration', () => {
    expect(suggest(ntsa.partial, SPOUSE)).toEqual([
      {
        sectionKey: `statement:${SPOUSE}`,
        itemType: 'vehicle',
        fields: { description: 'Vehicle kbz 789c', registration: 'kbz 789c' },
        sourceRef: { registration: 'kbz 789c' },
        matchKeys: ['registration:KBZ789C'],
      },
    ]);
  });
});

describe('ArdhiSasa → land', () => {
  it('maps each parcel to a land asset with size in hectares and a county code', () => {
    const suggestions = suggest(ardhisasa.found, 'officer');

    expect(suggestions).toEqual([
      {
        sectionKey: 'statement:officer',
        itemType: 'land',
        fields: {
          description: 'Land in Uasin Gishu',
          parcelNumber: 'Uasin Gishu/Kimumu/2231',
          size: '0.2 ha',
          county: '027',
        },
        sourceRef: {
          parcelNumber: 'Uasin Gishu/Kimumu/2231',
          tenure: 'freehold',
          registeredOn: '2015-06-30',
        },
        matchKeys: ['parcel:UASIN GISHU/KIMUMU/2231'],
      },
      {
        sectionKey: 'statement:officer',
        itemType: 'land',
        fields: {
          description: 'Land in Nairobi City',
          parcelNumber: 'Nairobi/Block 82/1234',
          size: '0.045 ha',
          county: '047',
        },
        sourceRef: {
          parcelNumber: 'Nairobi/Block 82/1234',
          tenure: 'leasehold',
          registeredOn: '2020-11-02',
        },
        matchKeys: ['parcel:NAIROBI/BLOCK 82/1234'],
      },
    ]);
    expectNoValues(suggestions);
  });

  it('suggests nothing for an empty result', () => {
    expect(suggest(ardhisasa.empty, 'officer')).toEqual([]);
  });

  it('handles partial parcels: county codes, unknown counties, missing size or number', () => {
    expect(suggest(ardhisasa.partial, CHILD)).toEqual([
      {
        sectionKey: `statement:${CHILD}`,
        itemType: 'land',
        fields: {
          description: 'Land in Kajiado',
          parcelNumber: 'Kajiado/Kitengela/5512',
          county: '034',
        },
        sourceRef: { parcelNumber: 'Kajiado/Kitengela/5512', registeredOn: '2018-02-01' },
        matchKeys: ['parcel:KAJIADO/KITENGELA/5512'],
      },
      {
        sectionKey: `statement:${CHILD}`,
        itemType: 'land',
        fields: {
          description: 'Land parcel LR 209/1234',
          parcelNumber: 'LR 209/1234',
          size: '1.25 ha',
          location: 'Coast Province',
        },
        sourceRef: {
          parcelNumber: 'LR 209/1234',
          tenure: 'leasehold',
          registeredOn: '1998-07-15',
        },
        matchKeys: ['parcel:LR 209/1234'],
      },
    ]);
  });
});

describe('BRS → shareholding and directorship', () => {
  const agrovet = {
    registrationNumber: 'PVT-AB12CD3E',
    companyStatus: 'registered',
    appointedOn: '2017-04-10',
  };
  const transporters = {
    registrationNumber: 'PVT-XY98ZW7Q',
    companyStatus: 'registered',
    appointedOn: '2021-09-01',
  };
  const millers = {
    registrationNumber: 'PVT-LM45NP6R',
    companyStatus: 'registered',
    appointedOn: '2014-02-17',
  };

  it('maps shares held to shareholdings and the officer’s directorships to paragraph 9', () => {
    const suggestions = suggest(brs.found, 'officer');

    expect(suggestions).toEqual([
      {
        sectionKey: 'statement:officer',
        itemType: 'shareholding',
        fields: {
          description: 'Shares in Rift Valley Agrovet Ltd',
          companyName: 'Rift Valley Agrovet Ltd',
          registrationNumber: 'PVT-AB12CD3E',
          role: 'Shareholder',
          shares: 500,
        },
        sourceRef: agrovet,
        matchKeys: ['company-name:RIFTVALLEYAGROVETLTD'],
      },
      // A director without shares is not a shareholding.
      {
        sectionKey: 'other',
        itemType: 'directorship',
        fields: { companyName: 'Kimumu Transporters Limited', role: 'Director' },
        sourceRef: transporters,
        matchKeys: ['company-name:KIMUMUTRANSPORTERSLTD'],
      },
      // A director holding shares is both.
      {
        sectionKey: 'statement:officer',
        itemType: 'shareholding',
        fields: {
          description: 'Shares in Eldoret Grain Millers Ltd',
          companyName: 'Eldoret Grain Millers Ltd',
          registrationNumber: 'PVT-LM45NP6R',
          role: 'Managing Director',
          shares: 2000,
        },
        sourceRef: millers,
        matchKeys: ['company-name:ELDORETGRAINMILLERSLTD'],
      },
      {
        sectionKey: 'other',
        itemType: 'directorship',
        fields: { companyName: 'Eldoret Grain Millers Ltd', role: 'Managing Director' },
        sourceRef: millers,
        matchKeys: ['company-name:ELDORETGRAINMILLERSLTD'],
      },
    ]);
    expectNoValues(suggestions);
  });

  it('suggests only shareholdings for a spouse, whose directorships declaration.v1 does not hold', () => {
    expect(suggest(brs.found, SPOUSE).map((each) => [each.sectionKey, each.itemType])).toEqual([
      [`statement:${SPOUSE}`, 'shareholding'],
      [`statement:${SPOUSE}`, 'shareholding'],
    ]);
  });

  it('suggests nothing for an empty result', () => {
    expect(suggest(brs.empty, 'officer')).toEqual([]);
  });

  it('describes a nameless company by its number and skips records with nothing to declare', () => {
    expect(suggest(brs.partial, 'officer')).toEqual([
      {
        sectionKey: 'statement:officer',
        itemType: 'shareholding',
        fields: {
          description: 'Shares in CPR/2009/12345',
          registrationNumber: 'CPR/2009/12345',
          shares: 150,
        },
        sourceRef: { registrationNumber: 'CPR/2009/12345' },
        matchKeys: [],
      },
    ]);
  });
});

describe('KRA → bio tax fields and income hint', () => {
  it('maps the officer’s PIN and compliance to the bio, and declared income to a hint', () => {
    const suggestions = suggest(kra.found, 'officer');

    expect(suggestions).toEqual([
      {
        sectionKey: 'bio',
        itemType: 'bio-tax',
        fields: { kraPin: 'A005231876K', complianceStatus: 'compliant' },
        sourceRef: {
          kraPin: 'A005231876K',
          registeredOn: '2012-08-20',
          certificateNumber: 'KRATCC2026-000123',
          validUntil: '2027-03-31',
        },
        matchKeys: ['kra-pin:A005231876K'],
      },
      {
        sectionKey: 'statement:officer',
        itemType: 'income-hint',
        fields: { incomeType: 'salary-emoluments' },
        sourceRef: { kraPin: 'A005231876K', annualIncomeDeclaredKesCents: 142_800_000 },
        matchKeys: [],
      },
    ]);
    expectNoValues(suggestions);
  });

  it('puts a spouse’s PIN in the household and gives no hint without income data', () => {
    expect(suggest(kra.partial, SPOUSE)).toEqual([
      {
        sectionKey: 'household',
        itemType: 'bio-tax',
        fields: { kraPin: 'A006612874M', complianceStatus: 'unknown' },
        sourceRef: { kraPin: 'A006612874M', registeredOn: '2016-01-11' },
        matchKeys: ['kra-pin:A006612874M'],
      },
    ]);
  });

  it('suggests no PIN for a child, whose record has no PIN field, but keeps the hint', () => {
    expect(suggest(kra.found, CHILD).map((each) => [each.sectionKey, each.itemType])).toEqual([
      [`statement:${CHILD}`, 'income-hint'],
    ]);
  });

  it('suggests nothing for an empty result', () => {
    expect(suggest(kra.empty, 'officer')).toEqual([]);
  });
});

describe('mapRegistryResult', () => {
  it('keeps the verification result the suggestions came from', () => {
    const set = mapRegistryResult(kra.found, 'officer');

    expect(set).toMatchObject({
      source: 'kra',
      verificationResultId: '9c4a5d1b-3e4f-4f88-8f4b-5c3d6e7f8a01',
      checkedAt: '2026-09-20T08:30:00.000Z',
    });
    expect(set.suggestions).toHaveLength(2);
    expect(mapRegistryResult(ntsa.unavailable, 'officer')).toEqual({
      source: 'ntsa',
      verificationResultId: ntsa.unavailable.resultId,
      checkedAt: ntsa.unavailable.checkedAt,
      suggestions: [],
    });
  });

  it('suggests nothing for not-found and unavailable outcomes', () => {
    for (const result of [ntsa.notFound, ntsa.unavailable, brs.notFound, ardhisasa.unavailable]) {
      expect(suggest(result, 'officer')).toEqual([]);
    }
    // Even if an unavailable answer somehow carries records, they are not trusted.
    expect(suggest({ ...kra.unavailable, taxpayers: kra.found.taxpayers }, 'officer')).toEqual([]);
  });
});

describe('field vocabulary', () => {
  // The portal's accept mapping reads these keys (see `Suggestion.fields` in declarations.yaml).
  const VOCABULARY: Record<MappedSuggestion['itemType'], string[]> = {
    vehicle: ['description', 'registration', 'make', 'model', 'year'],
    land: ['description', 'parcelNumber', 'size', 'location', 'county'],
    shareholding: ['description', 'companyName', 'registrationNumber', 'role', 'shares'],
    directorship: ['companyName', 'role'],
    'bio-tax': ['kraPin', 'complianceStatus'],
    'income-hint': ['incomeType'],
  };

  it('uses exactly the portal’s field keys for each item type', () => {
    const seen = new Map<string, Set<string>>();
    const results = [ntsa, ardhisasa, brs, kra].flatMap((fixtures) => [
      fixtures.found,
      fixtures.partial,
    ]);
    for (const result of results) {
      for (const personKey of ['officer', SPOUSE] as const) {
        for (const { itemType, fields } of suggest(result, personKey)) {
          const keys = seen.get(itemType) ?? new Set<string>();
          for (const key of Object.keys(fields)) keys.add(key);
          seen.set(itemType, keys);
        }
      }
    }

    expect(
      Object.fromEntries([...seen].map(([itemType, keys]) => [itemType, [...keys].sort()])),
    ).toEqual(
      Object.fromEntries(
        Object.entries(VOCABULARY).map(([itemType, keys]) => [itemType, [...keys].sort()]),
      ),
    );
  });
});

describe('countyCode', () => {
  it.each([
    ['Uasin Gishu', '027'],
    ['uasin-gishu county', '027'],
    ['Nairobi', '047'],
    ['Nairobi City County', '047'],
    ['Taita Taveta', '006'],
    ["Murang'a", '021'],
    ['Muranga', '021'],
    ['032', '032'],
  ])('reads %s as %s', (county, code) => {
    expect(countyCode(county)).toBe(code);
  });

  it.each(['', 'Coast Province', '048', '000'])('does not guess for %j', (county) => {
    expect(countyCode(county)).toBeUndefined();
  });
});
