import type { AssetItem, IncomeItem } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import {
  companyNameMatchKey,
  companyNumberMatchKey,
  findMatchingItem,
  kraPinMatchKey,
  matchKeysOfItem,
  matchKeysOfSpouse,
  parcelMatchKey,
  registrationMatchKey,
} from '../../src/suggestions/match-keys.js';
import {
  mapArdhisasaResult,
  mapBrsResult,
  mapKraResult,
  mapNtsaResult,
} from '../../src/suggestions/registry-mapping.js';
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

  it('normalise company numbers, names and PINs', () => {
    expect(companyNumberMatchKey('PVT-AB12CD3E')).toBe('company-number:PVTAB12CD3E');
    expect(companyNameMatchKey('Rift Valley Agrovet Limited')).toBe(
      companyNameMatchKey('RIFT VALLEY AGROVET LTD.'),
    );
    expect(kraPinMatchKey('a005231876k')).toBe('kra-pin:A005231876K');
  });

  it('read the identifier each item type carries', () => {
    expect(matchKeysOfItem(asset('a', 'vehicle', { registration: 'KCA 123A' }))).toEqual([
      'registration:KCA123A',
    ]);
    expect(matchKeysOfItem(asset('b', 'building', { parcelNumber: 'LR 209/1234' }))).toEqual([
      'parcel:LR 209/1234',
    ]);
    expect(matchKeysOfItem(asset('c', 'securities', { issuer: 'Safaricom PLC' }))).toEqual([
      'company-name:SAFARICOMPLC',
    ]);
    expect(matchKeysOfItem(asset('d', 'vehicle', {}))).toEqual([]);
    expect(matchKeysOfItem(asset('e', 'cash', { institution: 'KCB' }))).toEqual([]);
    expect(matchKeysOfItem(salary)).toEqual([]);
    expect(matchKeysOfSpouse({ kraPin: 'A006612874M' })).toEqual(
      mapKraResult(kra.partial, 'spouse:x')[0]?.matchKeys,
    );
    expect(matchKeysOfSpouse({})).toEqual([]);
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
    const [fielder, dmax] = mapNtsaResult(ntsa.found, 'officer');
    const [kimumu, nairobi] = mapArdhisasaResult(ardhisasa.found, 'officer');
    const [agrovet, transporters] = mapBrsResult(brs.found, 'officer');

    expect(fielder && findMatchingItem(fielder, items)).toBe(items[1]?.id);
    expect(dmax && findMatchingItem(dmax, items)).toBeNull();
    expect(kimumu && findMatchingItem(kimumu, items)).toBe(items[2]?.id);
    expect(nairobi && findMatchingItem(nairobi, items)).toBeNull();
    expect(agrovet && findMatchingItem(agrovet, items)).toBe(items[3]?.id);
    expect(transporters && findMatchingItem(transporters, items)).toBeNull();
  });

  it('never matches a suggestion without keys, or across identifier kinds', () => {
    const hint = mapKraResult(kra.found, 'officer').find((each) => each.itemType === 'income-hint');
    expect(hint && findMatchingItem(hint, items)).toBeNull();

    const sameDigits = [asset('x', 'land', { parcelNumber: 'KCA123A' })];
    const [fielder] = mapNtsaResult(ntsa.found, 'officer');
    expect(fielder && findMatchingItem(fielder, sameDigits)).toBeNull();
  });
});
