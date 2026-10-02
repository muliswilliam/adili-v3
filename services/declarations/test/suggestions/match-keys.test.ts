import type { AssetItem, IncomeItem } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import {
  companyNameMatchKey,
  companyNumberMatchKey,
  findMatchingItem,
  kraPinMatchKey,
  matchKeysFor,
  matchKeysOfDirectorship,
  matchKeysOfItem,
  parcelMatchKey,
  presentKeys,
  registrationMatchKey,
} from '../../src/suggestions/match-keys.js';
import { mapRegistryResult } from '../../src/suggestions/registry-mapping.js';
import { ardhisasa, brs, kra, ntsa } from '../fixtures/registry-results.js';

function asset(id: string, type: AssetItem['type'], details: AssetItem['details']): AssetItem {
  return {
    id,
    type,
    description: 'Entered by hand',
    details,
    value: { kesCents: 100_000_00 },
    location: { inKenya: true },
    joint: { isJoint: false },
    change: { changed: false },
  };
}

function suggest(...args: Parameters<typeof mapRegistryResult>) {
  return mapRegistryResult(...args).suggestions;
}

const salary: IncomeItem = {
  id: '00000000-0000-4000-8000-000000000009',
  type: 'salary-emoluments',
  description: 'Salary',
  amount: { kesCents: 1 },
  location: { inKenya: true },
  change: { changed: false },
};

describe('match keys', () => {
  it('normalise registrations without case, spaces or separators', () => {
    expect(registrationMatchKey('kca 123a')).toBe('registration:KCA123A');
    expect(registrationMatchKey('KCA-123 A')).toBe(registrationMatchKey('KCA123A'));
    expect(registrationMatchKey('  ')).toBeNull();
  });

  it('normalise parcels but keep their separators', () => {
    expect(parcelMatchKey(' uasin gishu / Kimumu /2231 ')).toBe('parcel:UASIN GISHU/KIMUMU/2231');
    expect(parcelMatchKey('Block 7/1234')).not.toBe(parcelMatchKey('Block 71/234'));
    expect(parcelMatchKey('')).toBeNull();
  });

  it('normalise company names, company numbers and PINs', () => {
    expect(companyNameMatchKey('Rift Valley Agrovet Limited')).toBe(
      companyNameMatchKey('RIFT VALLEY AGROVET LTD.'),
    );
    expect(companyNumberMatchKey('pvt-ab12cd3e')).toBe('company-number:PVTAB12CD3E');
    expect(companyNumberMatchKey('CPR/2009/12345')).toBe(companyNumberMatchKey('CPR 2009 12345'));
    expect(kraPinMatchKey('a005231876k')).toBe('kra-pin:A005231876K');
  });

  it('key a company on an item or directorship by its name and by its number', () => {
    expect(matchKeysOfItem(asset('a', 'shareholding', { issuer: 'PVT-AB12CD3E' }))).toContain(
      'company-number:PVTAB12CD3E',
    );
    const directorship = {
      company: 'Kimumu Transporters Ltd',
      role: 'Director',
      remunerated: false,
    };
    expect(matchKeysOfDirectorship(directorship)).toEqual([
      'company-name:KIMUMUTRANSPORTERSLTD',
      'company-number:KIMUMUTRANSPORTERSLTD',
    ]);
    expect(matchKeysOfDirectorship({ ...directorship, company: ' ' })).toEqual([]);
  });

  it('read the identifier each item type carries', () => {
    expect(matchKeysOfItem(asset('a', 'vehicle', { registration: 'KCA 123A' }))).toEqual([
      'registration:KCA123A',
    ]);
    expect(matchKeysOfItem(asset('b', 'building', { parcelNumber: 'LR 209/1234' }))).toEqual([
      'parcel:LR 209/1234',
    ]);
    expect(matchKeysOfItem(asset('c', 'securities', { issuer: 'Safaricom PLC' }))).toContain(
      'company-name:SAFARICOMPLC',
    );
    expect(matchKeysOfItem(asset('d', 'vehicle', {}))).toEqual([]);
    expect(matchKeysOfItem(asset('e', 'cash', { institution: 'KCB' }))).toEqual([]);
    expect(matchKeysOfItem(salary)).toEqual([]);
  });

  it('key an identifier the way an item of that type holds it', () => {
    expect(matchKeysFor('vehicle', 'KCA 123A')).toEqual(
      matchKeysOfItem(asset('a', 'vehicle', { registration: 'kca-123a' })),
    );
    expect(matchKeysFor('shareholding', 'Safaricom PLC')).toContain('company-name:SAFARICOMPLC');
    expect(matchKeysFor('land', '')).toEqual([]);
  });

  it('drop identifiers that normalised to nothing', () => {
    expect(presentKeys(kraPinMatchKey('a005231876k'), kraPinMatchKey(' - '), undefined)).toEqual([
      'kra-pin:A005231876K',
    ]);
  });
});

describe('findMatchingItem', () => {
  const items = [
    salary,
    asset('11111111-1111-4111-8111-111111111111', 'vehicle', { registration: 'kca123a' }),
    asset('22222222-2222-4222-8222-222222222222', 'land', {
      parcelNumber: 'UASIN GISHU/KIMUMU/2231',
    }),
    asset('33333333-3333-4333-8333-333333333333', 'shareholding', {
      issuer: 'Rift Valley Agrovet Limited',
    }),
  ];

  it('matches a registry suggestion to the item with the same identifier', () => {
    const [fielder, dmax] = suggest(ntsa.found, 'officer');
    const [kimumu, nairobi] = suggest(ardhisasa.found, 'officer');
    const [agrovet, , millers] = suggest(brs.found, 'officer');

    expect(fielder && findMatchingItem(fielder, items)).toBe(items[1]?.id);
    expect(dmax && findMatchingItem(dmax, items)).toBeNull();
    expect(kimumu && findMatchingItem(kimumu, items)).toBe(items[2]?.id);
    expect(nairobi && findMatchingItem(nairobi, items)).toBeNull();
    expect(agrovet && findMatchingItem(agrovet, items)).toBe(items[3]?.id);
    expect(millers && findMatchingItem(millers, items)).toBeNull();
  });

  it('matches a nameless BRS company to an item that names it by its number', () => {
    const [nameless] = suggest(brs.partial, 'officer');
    const byNumber = asset('44444444-4444-4444-8444-444444444444', 'shareholding', {
      issuer: 'CPR/2009/12345',
    });
    expect(nameless && findMatchingItem(nameless, [...items, byNumber])).toBe(byNumber.id);
  });

  it('never matches a suggestion without keys, or across identifier kinds', () => {
    const hint = suggest(kra.found, 'officer').find((each) => each.itemType === 'income-hint');
    expect(hint && findMatchingItem(hint, items)).toBeNull();

    const sameDigits = [asset('x', 'land', { parcelNumber: 'KCA123A' })];
    const [fielder] = suggest(ntsa.found, 'officer');
    expect(fielder && findMatchingItem(fielder, sameDigits)).toBeNull();
  });
});
