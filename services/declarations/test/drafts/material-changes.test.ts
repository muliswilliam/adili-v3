import { describe, expect, it } from 'vitest';

import { composeMaterialChanges } from '../../src/drafts/material-changes.js';
import {
  assetItem,
  bio,
  CHILD_ID,
  incomeItem,
  liabilityItem,
  SPOUSE_ID,
  statement,
} from '../fixtures/sections.js';

const promoted = { changed: true, kind: 'value-change', explanation: 'Promoted in 2026.' } as const;

describe('composeMaterialChanges (S9)', () => {
  it('lists flagged items with a reference to each, person by person', () => {
    const officer = {
      ...statement(),
      income: [{ ...incomeItem(), change: promoted }],
      liabilitiesNil: false,
      liabilities: [
        {
          ...liabilityItem(),
          change: { changed: true, kind: 'settled', explanation: 'Paid off in 2027.' },
        },
      ],
    } as const;
    const spouse = {
      ...statement(),
      assets: [
        {
          ...assetItem(),
          change: { changed: true, kind: 'acquisition', explanation: 'Bought in 2026.' },
        },
      ],
    } as const;

    expect(
      composeMaterialChanges({
        bio: bio(),
        statements: [
          ['officer', officer],
          [`spouse:${SPOUSE_ID}`, spouse],
          [`child:${CHILD_ID}`, statement()],
        ],
      }),
    ).toEqual([
      {
        personKey: 'officer',
        itemId: incomeItem().id,
        itemDescription: 'Salary',
        kind: 'value-change',
        explanation: 'Promoted in 2026.',
      },
      {
        personKey: 'officer',
        itemId: liabilityItem().id,
        itemDescription: 'Car loan',
        kind: 'settled',
        explanation: 'Paid off in 2027.',
      },
      {
        personKey: `spouse:${SPOUSE_ID}`,
        itemId: assetItem().id,
        itemDescription: 'Toyota Prado',
        kind: 'acquisition',
        explanation: 'Bought in 2026.',
      },
    ]);
  });

  it('puts the marital-status change first', () => {
    expect(
      composeMaterialChanges({
        bio: {
          ...bio(),
          maritalStatusChange: { changed: true, explanation: 'Married in March 2026.' },
        },
        statements: [
          ['officer', { ...statement(), income: [{ ...incomeItem(), change: promoted }] }],
        ],
      }).map((entry) => entry.kind),
    ).toEqual(['marital-status', 'value-change']);
  });

  it.each([
    ['not changed', { changed: false, kind: 'value-change', explanation: 'Old note.' }],
    ['changed without a kind', { changed: true, explanation: 'Promoted.' }],
    ['changed without an explanation', { changed: true, kind: 'value-change' }],
    ['changed with a blank explanation', { changed: true, kind: 'value-change', explanation: ' ' }],
  ])('leaves out an item %s', (_name, change) => {
    expect(
      composeMaterialChanges({
        bio: { ...bio(), maritalStatusChange: { changed: true } },
        statements: [['officer', { ...statement(), income: [{ ...incomeItem(), change }] }]],
      }),
    ).toEqual([]);
  });

  it("lists flagged directorships and memberships after the statements, as the declarant's", () => {
    expect(
      composeMaterialChanges({
        bio: bio(),
        statements: [
          ['officer', { ...statement(), income: [{ ...incomeItem(), change: promoted }] }],
        ],
        interests: {
          directorships: [
            {
              company: 'Lake Basin Holdings Ltd',
              role: 'Director',
              remunerated: true,
              change: { changed: true, kind: 'acquisition', explanation: 'Appointed in 2026.' },
            },
            { company: 'Old Co Ltd', role: 'Director', remunerated: false },
          ],
          memberships: [
            {
              entity: 'Kisumu Golf Club',
              kind: 'club',
              change: { changed: true, kind: 'acquisition', explanation: 'Joined in 2027.' },
            },
            {
              entity: 'Unexplained Sacco',
              kind: 'society',
              change: { changed: true, explanation: 'x' },
            },
          ],
        },
      }),
    ).toEqual([
      expect.objectContaining({ kind: 'value-change' }),
      {
        personKey: 'officer',
        itemDescription: 'Lake Basin Holdings Ltd',
        kind: 'directorship',
        explanation: 'Appointed in 2026.',
      },
      {
        personKey: 'officer',
        itemDescription: 'Kisumu Golf Club',
        kind: 'membership',
        explanation: 'Joined in 2027.',
      },
    ]);
  });

  it('tolerates partial drafts', () => {
    expect(
      composeMaterialChanges({
        bio: undefined,
        statements: [['officer', { income: 'x' }]],
        interests: { directorships: 'x', memberships: [null] },
      }),
    ).toEqual([]);
  });
});
