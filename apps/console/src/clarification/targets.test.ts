import { describe, expect, it } from 'vitest';

import { MOCK_DECLARATION, MOCK_ITEM_IDS } from '../server/review/copilot-mock.server';
import { clarificationTargets, labelOf, targetOf } from './targets';

const SPOUSE = 'spouse:5b0e0000-0000-4000-8000-000000000201';

describe('clarificationTargets', () => {
  const targets = clarificationTargets(MOCK_DECLARATION);

  it('lists the declaration sections first, then each statement with its items', () => {
    expect(targets.map((target) => [target.group, target.label])).toEqual([
      ['Declaration', 'Personal details'],
      ['Declaration', 'Spouses and children'],
      ['Declaration', 'Other information'],
      ['John Kennedy Otieno', 'Financial statement · John Kennedy Otieno'],
      [
        'John Kennedy Otieno',
        'Income · Salary from the Teachers Service Commission · John Kennedy Otieno',
      ],
      [
        'John Kennedy Otieno',
        'Income · Rent from a bedsitter block in Kondele · John Kennedy Otieno',
      ],
      ['John Kennedy Otieno', 'Assets · Plot Kisumu/Manyatta/1234 · John Kennedy Otieno'],
      ['John Kennedy Otieno', 'Assets · Three-bedroom house in Milimani · John Kennedy Otieno'],
      ['John Kennedy Otieno', 'Assets · CIC Money Market Fund units · John Kennedy Otieno'],
      ['John Kennedy Otieno', 'Assets · Shares in Mwalimu National SACCO · John Kennedy Otieno'],
      ['John Kennedy Otieno', 'Liabilities · Mortgage from KCB Bank · John Kennedy Otieno'],
      ['Lilian Akoth Otieno', 'Financial statement · Lilian Akoth Otieno'],
      [
        'Lilian Akoth Otieno',
        'Income · Profit from a cereals shop in Kibuye market · Lilian Akoth Otieno',
      ],
      ['Lilian Akoth Otieno', 'Assets · Shop stock · Lilian Akoth Otieno'],
      ['Brenda Otieno', 'Financial statement · Brenda Otieno'],
      ['Brenda Otieno', 'Assets · Unit trust savings for school fees · Brenda Otieno'],
    ]);
  });

  it('points each target at what review.yaml ClarificationItemInput names', () => {
    expect(targets.find((target) => target.label === 'Personal details')?.ref).toEqual({
      sectionKey: 'bio',
      personKey: null,
      itemId: null,
    });
    expect(
      targets.find((target) => target.label.startsWith('Financial statement · Lilian'))?.ref,
    ).toEqual({
      sectionKey: `statement:${SPOUSE}`,
      personKey: SPOUSE,
      itemId: null,
    });
    expect(targets.find((target) => target.label.startsWith('Assets · Plot'))).toMatchObject({
      kind: 'item',
      ref: { sectionKey: 'statement:officer', personKey: 'officer', itemId: MOCK_ITEM_IDS.plot },
    });
  });

  it('still offers the sections without a document', () => {
    expect(clarificationTargets(null).map((target) => target.label)).toEqual([
      'Personal details',
      'Spouses and children',
      'Other information',
    ]);
  });
});

describe('targetOf and labelOf', () => {
  const targets = clarificationTargets(MOCK_DECLARATION);

  it('finds the target of a saved item by item, then by statement or section', () => {
    const plot = {
      sectionKey: 'statement:officer',
      personKey: 'officer',
      itemId: MOCK_ITEM_IDS.plot,
    };
    expect(targetOf(plot, targets)?.label).toBe(
      'Assets · Plot Kisumu/Manyatta/1234 · John Kennedy Otieno',
    );
    expect(
      targetOf({ sectionKey: 'statement:officer', personKey: 'officer', itemId: null }, targets)
        ?.label,
    ).toBe('Financial statement · John Kennedy Otieno');
    expect(targetOf({ sectionKey: null, personKey: SPOUSE, itemId: null }, targets)?.label).toBe(
      'Financial statement · Lilian Akoth Otieno',
    );
    expect(
      targetOf({ sectionKey: 'household', personKey: null, itemId: null }, targets)?.label,
    ).toBe('Spouses and children');
  });

  it('keeps a target the current version no longer has, under its saved label', () => {
    const gone = {
      sectionKey: 'statement:officer',
      personKey: 'officer',
      itemId: '1e2d3c4b-0000-4000-8000-0000000000ff',
      label: 'Assets · Old car · John Kennedy',
    };
    expect(targetOf(gone, targets)).toEqual({
      key: 'saved:statement:officer:officer:1e2d3c4b-0000-4000-8000-0000000000ff',
      group: 'Saved',
      label: 'Assets · Old car · John Kennedy',
      kind: 'item',
      ref: { sectionKey: 'statement:officer', personKey: 'officer', itemId: gone.itemId },
    });
    expect(labelOf(gone, targets)).toBe('Assets · Old car · John Kennedy');
  });

  it('has no target for an item that names nothing', () => {
    expect(targetOf({ sectionKey: null, personKey: null, itemId: null }, targets)).toBeNull();
    expect(labelOf({ sectionKey: null, personKey: null, itemId: null }, targets)).toBe(
      'Declaration',
    );
  });
});
