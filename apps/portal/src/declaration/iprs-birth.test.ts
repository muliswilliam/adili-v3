import { describe, expect, it } from 'vitest';

import type { LoadedSuggestion, LoadedSuggestionSet } from '../server/declarations.server';
import { bioHolds, birthOf, birthSuggestion, birthTitle, latestIprsSet } from './iprs-birth';

function suggestion(overrides: Partial<LoadedSuggestion> = {}): LoadedSuggestion {
  return {
    id: crypto.randomUUID(),
    setId: crypto.randomUUID(),
    personKey: 'officer',
    sectionKey: 'bio',
    itemType: 'bio-birth',
    fields: { dateOfBirth: '1984-03-12', placeOfBirth: 'Eldoret' },
    sourceRef: {},
    confidence: null,
    matchItemId: null,
    status: 'new',
    acceptedItemId: null,
    ...overrides,
  };
}

function set(overrides: Partial<LoadedSuggestionSet> = {}): LoadedSuggestionSet {
  return {
    id: crypto.randomUUID(),
    personKey: 'officer',
    source: 'iprs',
    status: 'ready',
    requestedAt: '2027-10-01T08:00:00.000Z',
    readyAt: '2027-10-01T08:00:02.000Z',
    verificationResultId: null,
    aiJobId: null,
    attachmentId: null,
    documentKind: null,
    reason: null,
    suggestions: [suggestion()],
    ...overrides,
  };
}

describe('latestIprsSet', () => {
  it("picks the declarant's latest IPRS check, ignoring other registries", () => {
    const later = set({ requestedAt: '2027-10-02T08:00:00.000Z' });
    expect(latestIprsSet([set(), later, set({ source: 'kra', requestedAt: '2027-10-03' })])).toBe(
      later,
    );
    expect(latestIprsSet([set({ source: 'kra' })])).toBeNull();
  });
});

describe('birthSuggestion', () => {
  it('skips a superseded suggestion', () => {
    expect(birthSuggestion(set({ suggestions: [suggestion({ status: 'superseded' })] }))).toBe(
      null,
    );
    expect(birthSuggestion(null)).toBeNull();
  });
});

describe('birthOf and birthTitle', () => {
  it('reads the date and place, leaving out what IPRS did not give', () => {
    expect(birthOf(suggestion())).toEqual({ date: '1984-03-12', place: 'Eldoret' });
    expect(birthOf(suggestion({ fields: { dateOfBirth: '1984-03-12' } }))).toEqual({
      date: '1984-03-12',
    });
    expect(birthTitle({ date: '1984-03-12', place: 'Eldoret' })).toBe(
      'Born 12 Mar 1984 in Eldoret',
    );
    expect(birthTitle({ date: '1984-03-12' })).toBe('Born 12 Mar 1984');
  });
});

describe('bioHolds', () => {
  it('is true only when the bio already says what IPRS does', () => {
    const birth = { date: '1984-03-12', place: 'Eldoret' };
    expect(bioHolds({ date: '1984-03-12', place: 'eldoret ' }, birth)).toBe(true);
    expect(bioHolds({ date: '1984-03-12' }, birth)).toBe(false);
    expect(bioHolds({ date: '1984-03-12', place: 'Nakuru' }, { date: '1984-03-12' })).toBe(true);
  });
});
