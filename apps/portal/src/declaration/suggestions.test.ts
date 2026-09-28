import { emptyFieldDiff } from '@adili/ui';
import { describe, expect, it } from 'vitest';

import type {
  JsonObject,
  LoadedSuggestion,
  LoadedSuggestionSet,
} from '../server/declarations.server';
import { contractEnum } from '../test/contract';
import type { Draft, Statement } from './contents';
import type { Item } from './statement';
import {
  categoryOf,
  editFields,
  editValue,
  findMatch,
  isChecking,
  lastChecked,
  maskKraPin,
  REGISTRIES,
  registryEntries,
  shownSuggestions,
  suggestionPatch,
  suggestionTitle,
  supersededBy,
  valuesAt,
  withAcceptedItem,
  withSuggestion,
} from './suggestions';

const vehicle = {
  itemType: 'vehicle',
  fields: { registration: 'KCA 123A', make: 'Toyota', model: 'Fielder', year: 2016 },
};
const land = {
  itemType: 'land',
  fields: {
    parcelNumber: 'Uasin Gishu/Kimumu/2231',
    size: '0.5 acres',
    location: 'Kimumu',
    county: '027',
  },
};
const shares = {
  itemType: 'shareholding',
  fields: {
    companyName: 'Rift Valley Agrovet Ltd',
    registrationNumber: 'PVT-AB12CD3E',
    role: 'Shareholder',
    shares: 500,
  },
};
const kra = {
  itemType: 'bio-tax',
  fields: { kraPin: 'A005231876K', complianceStatus: 'compliant' },
};

describe('suggestionTitle', () => {
  it('composes a title per item type from the fields', () => {
    expect(suggestionTitle(vehicle)).toBe('KCA 123A · Toyota Fielder 2016');
    expect(suggestionTitle(land)).toBe('Uasin Gishu/Kimumu/2231 · 0.5 acres');
    expect(suggestionTitle(shares)).toBe('Rift Valley Agrovet Ltd · 500 shares');
    expect(suggestionTitle(kra)).toBe('KRA PIN A00•••••76K · Compliance: Compliant');
  });

  it("reads BRS's investment as a shareholding and falls back to the role", () => {
    expect(
      suggestionTitle({
        itemType: 'investment',
        fields: { companyName: 'Kapsoya Water Project Ltd', role: 'Director' },
      }),
    ).toBe('Kapsoya Water Project Ltd · Director');
  });

  it('skips missing or unusable fields', () => {
    expect(suggestionTitle({ itemType: 'vehicle', fields: { registration: ' KDA 123X ' } })).toBe(
      'KDA 123X',
    );
    expect(suggestionTitle({ itemType: 'vehicle', fields: { make: 'Isuzu', year: null } })).toBe(
      'Isuzu',
    );
    expect(suggestionTitle({ itemType: 'bio-tax', fields: { kraPin: 'A006612874M' } })).toBe(
      'KRA PIN A00•••••74M',
    );
  });

  it('falls back to the description, then the item type in words', () => {
    expect(suggestionTitle({ itemType: 'land', fields: { description: 'Family plot' } })).toBe(
      'Family plot',
    );
    expect(suggestionTitle({ itemType: 'vehicle', fields: {} })).toBe('Vehicle');
    expect(suggestionTitle({ itemType: 'hint', fields: { amount: {} } })).toBe('Suggestion');
  });
});

describe('maskKraPin', () => {
  it('keeps the first and last three characters', () => {
    expect(maskKraPin('A005231876K')).toBe('A00•••••76K');
    expect(maskKraPin('A0052')).toBe('A0052');
  });
});

describe('suggestionPatch', () => {
  it('maps a vehicle onto the asset fields, leaving the value empty', () => {
    expect(suggestionPatch(vehicle).map(({ path, value }) => [path, value])).toEqual([
      ['details.registration', 'KCA 123A'],
      ['details.makeModel', 'Toyota Fielder, 2016'],
      ['description', 'Toyota Fielder'],
    ]);
  });

  it('maps a parcel, showing the county by name', () => {
    const patch = suggestionPatch(land);
    expect(patch.map(({ path }) => path)).toEqual([
      'details.parcelNumber',
      'details.size',
      'location.detail',
      'location.county',
      'description',
    ]);
    expect(patch.find((each) => each.path === 'location.county')?.display).toBe('Uasin Gishu');
    expect(patch.at(-1)?.value).toBe('Land in Kimumu');
  });

  it('maps a shareholding and a KRA PIN', () => {
    expect(suggestionPatch(shares).map(({ path, value }) => [path, value])).toEqual([
      ['details.issuer', 'Rift Valley Agrovet Ltd'],
      ['details.quantityOrPercent', '500 shares'],
      ['description', 'Shares in Rift Valley Agrovet Ltd'],
    ]);
    expect(suggestionPatch(kra)).toEqual([
      { path: 'kraPin', label: 'KRA PIN', value: 'A005231876K', display: 'A00•••••76K' },
    ]);
  });

  it('takes an edited description', () => {
    const edited = { ...vehicle, fields: { ...vehicle.fields, description: 'Family car' } };
    expect(suggestionPatch(edited).at(-1)?.value).toBe('Family car');
  });
});

describe('applying to a matching item', () => {
  const item: Item = {
    id: 'a1',
    type: 'vehicle',
    description: 'Our car',
    details: { registration: 'KCA123A' },
  };

  it('finds the item by identifier, ignoring case and separators', () => {
    expect(findMatch(vehicle, [{ id: 'x', type: 'land' }, item])).toBe('a1');
    expect(findMatch({ itemType: 'vehicle', fields: { registration: 'KDA 1' } }, [item])).toBe(
      null,
    );
    expect(findMatch(kra, [item])).toBe(null);
  });

  it('lists what applying fills, for the card', () => {
    const patch = suggestionPatch(vehicle);
    const fills = emptyFieldDiff(
      patch.map(({ path, label, display }) => ({ key: path, label, value: display })),
      valuesAt(item, patch),
    );
    expect(fills.map((field) => field.label)).toEqual(['Make and model']);
  });
});

describe('categoryOf', () => {
  it('places item types in their statement category', () => {
    expect(categoryOf('vehicle')).toBe('assets');
    expect(categoryOf('investment')).toBe('assets');
    expect(categoryOf('salary-emoluments')).toBe('income');
    expect(categoryOf('loan')).toBe('liabilities');
    expect(categoryOf('bio-tax')).toBe(null);
  });
});

describe('edit and add', () => {
  it('offers the type fields, then the description it would add', () => {
    expect(editFields('vehicle').map((field) => field.key)).toEqual([
      'registration',
      'make',
      'model',
      'year',
      'description',
    ]);
    expect(editValue(vehicle, 'year')).toBe('2016');
    expect(editValue(vehicle, 'description')).toBe('Toyota Fielder');
  });
});

function suggestion(overrides: Partial<LoadedSuggestion> = {}): LoadedSuggestion {
  return {
    id: 's1',
    setId: 'ntsa-1',
    personKey: 'officer',
    sectionKey: 'statement:officer',
    itemType: 'vehicle',
    fields: vehicle.fields,
    sourceRef: { registration: 'KCA 123A' },
    confidence: null,
    matchItemId: null,
    status: 'new',
    acceptedItemId: null,
    ...overrides,
  };
}

function set(overrides: Partial<LoadedSuggestionSet> = {}): LoadedSuggestionSet {
  return {
    id: 'ntsa-1',
    personKey: 'officer',
    source: 'ntsa',
    status: 'ready',
    requestedAt: '2026-09-26T10:30:00Z',
    readyAt: '2026-09-26T10:32:00Z',
    verificationResultId: null,
    aiJobId: null,
    suggestions: [],
    ...overrides,
  };
}

describe('a person’s registry check', () => {
  it('covers every registry the contract has', () => {
    expect([...REGISTRIES, 'document'].sort()).toEqual(
      contractEnum('SuggestionSource', 'declarations.yaml').sort(),
    );
  });

  it('reads each registry’s newest set into the status strip', () => {
    const sets = [
      set({ status: 'ready', suggestions: [suggestion({ status: 'accepted' })] }),
      set({
        id: 'ntsa-2',
        requestedAt: '2026-09-27T09:00:00Z',
        readyAt: '2026-09-27T09:00:02Z',
        suggestions: [suggestion({ id: 's2', setId: 'ntsa-2' })],
      }),
      set({ id: 'kra-1', source: 'kra', status: 'pending', readyAt: null }),
      set({ id: 'brs-1', source: 'brs', status: 'ready' }),
      set({ id: 'land-1', source: 'ardhisasa', status: 'unavailable' }),
    ];
    expect(registryEntries(sets).map(({ name, status, count }) => [name, status, count])).toEqual([
      ['KRA', 'checking', 0],
      ['NTSA', 'found', 1],
      ['BRS', 'nothing-found', 0],
      ['ArdhiSasa', 'unavailable', 0],
    ]);
    expect(isChecking(sets)).toBe(true);
    expect(lastChecked(sets)).toBe('2026-09-27T09:00:02Z');
  });

  it('says nothing found when a re-check comes back empty', () => {
    const sets = [
      set({
        suggestions: [
          suggestion({ status: 'accepted' }),
          suggestion({ id: 's2', status: 'dismissed' }),
          suggestion({ id: 's3', status: 'superseded' }),
        ],
      }),
      set({ id: 'ntsa-2', requestedAt: '2026-09-27T09:00:00Z', readyAt: '2026-09-27T09:00:02Z' }),
    ];
    const ntsa = registryEntries(sets).find((entry) => entry.id === 'ntsa');
    expect([ntsa?.status, ntsa?.count]).toEqual(['nothing-found', 0]);
  });

  it('counts only the new suggestions of the latest set', () => {
    const sets = [
      set({
        suggestions: [
          suggestion({ status: 'accepted' }),
          suggestion({ id: 's2' }),
          suggestion({ id: 's3', status: 'dismissed' }),
        ],
      }),
    ];
    const ntsa = registryEntries(sets).find((entry) => entry.id === 'ntsa');
    expect([ntsa?.status, ntsa?.count]).toEqual(['found', 1]);
  });

  it('says not checked before any lookup', () => {
    expect(registryEntries([]).every((entry) => entry.status === 'not-checked')).toBe(true);
    expect(lastChecked([])).toBe(null);
    expect(isChecking([])).toBe(false);
  });

  it('shows new, accepted and dismissed suggestions by registry, never superseded ones', () => {
    const sets = [
      set({
        id: 'land-1',
        source: 'ardhisasa',
        suggestions: [suggestion({ id: 'p1', setId: 'land-1', itemType: 'land' })],
      }),
      set({
        suggestions: [
          suggestion({ status: 'superseded' }),
          suggestion({ id: 's2', status: 'dismissed' }),
        ],
      }),
      set({ id: 'kra-1', source: 'kra', suggestions: [suggestion({ id: 'k1', setId: 'kra-1' })] }),
    ];
    expect(shownSuggestions(sets).map((each) => [each.suggestion.id, each.source])).toEqual([
      ['k1', 'kra'],
      ['s2', 'ntsa'],
      ['p1', 'ardhisasa'],
    ]);
    expect(shownSuggestions(sets)[1]?.at).toBe('2026-09-26T10:32:00Z');
  });

  it('supersedes new suggestions of the registries asked again', () => {
    const sets = [
      set({ suggestions: [suggestion(), suggestion({ id: 's2', status: 'accepted' })] }),
      set({ id: 'kra-1', source: 'kra', suggestions: [suggestion({ id: 'k1', setId: 'kra-1' })] }),
    ];
    const next = supersededBy(sets, 'officer', ['ntsa']);
    expect(next.flatMap((each) => each.suggestions.map((one) => one.status))).toEqual([
      'superseded',
      'accepted',
      'new',
    ]);
    expect(supersededBy(sets, 'spouse:x', ['ntsa'])[0]?.suggestions[0]?.status).toBe('new');
  });

  it('puts an accepted or dismissed suggestion back into its set', () => {
    const sets = [set({ suggestions: [suggestion()] })];
    const next = withSuggestion(sets, suggestion({ status: 'dismissed' }));
    expect(next[0]?.suggestions[0]?.status).toBe('dismissed');
  });
});

describe('withAcceptedItem', () => {
  const local: Draft<Statement> = {
    assetsNil: true,
    assets: [{ id: 'a1', description: 'Typed on screen' }],
    income: [],
  };

  it('adds the new item from the section read back, keeping what is on screen', () => {
    const fresh: JsonObject = {
      assets: [
        { id: 'a1', description: 'Older' },
        { id: 'a2', type: 'vehicle', description: 'Toyota Fielder' },
      ],
    };
    const next = withAcceptedItem(local, fresh, 'a2');
    expect(next.assetsNil).toBe(false);
    expect(next.assets?.map((item) => item.description)).toEqual([
      'Typed on screen',
      'Toyota Fielder',
    ]);
  });

  it('replaces an item that was filled, and leaves the statement alone when it is missing', () => {
    const fresh = {
      assets: [{ id: 'a1', description: 'Typed on screen', details: { size: '1' } }],
    };
    expect(withAcceptedItem(local, fresh, 'a1').assets?.[0]?.details?.size).toBe('1');
    expect(withAcceptedItem(local, fresh, 'zz')).toBe(local);
  });
});
