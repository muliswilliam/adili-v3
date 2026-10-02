import { describe, expect, it } from 'vitest';

import type { ClarificationItem } from '../../src/cases/schema.js';
import {
  type DisclosureScope,
  disclosedClarification,
  type IssuedClarification,
  isItemInScope,
} from '../../src/clarifications/disclosure.js';

const SPOUSE = 'spouse:0192f1a0-5a11-7000-8000-000000000101';
const CHILD = 'child:0192f1a0-5a11-7000-8000-000000000201';

const everything: DisclosureScope = {
  includeSpouses: true,
  includeChildren: true,
  sections: ['bio', 'income', 'assets', 'liabilities', 'other'],
};

function item(overrides: Partial<ClarificationItem>): ClarificationItem {
  return {
    id: 'item',
    sectionKey: null,
    personKey: null,
    itemId: null,
    requirement: 'explain-discrepancy',
    text: 'Explain.',
    ...overrides,
  };
}

describe('isItemInScope', () => {
  it("needs a spouse's or a child's item to have them included", () => {
    const spouse = item({ sectionKey: `statement:${SPOUSE}`, personKey: SPOUSE });
    const child = item({ sectionKey: `statement:${CHILD}` });
    expect(isItemInScope(spouse, everything)).toBe(true);
    expect(isItemInScope(spouse, { ...everything, includeSpouses: false })).toBe(false);
    expect(isItemInScope(child, { ...everything, includeChildren: false })).toBe(false);
  });

  it('needs the section an item is on', () => {
    expect(isItemInScope(item({ sectionKey: 'bio' }), { ...everything, sections: ['bio'] })).toBe(
      true,
    );
    expect(isItemInScope(item({ sectionKey: 'bio' }), { ...everything, sections: ['other'] })).toBe(
      false,
    );
    expect(
      isItemInScope(item({ sectionKey: 'other' }), { ...everything, sections: ['other'] }),
    ).toBe(true);
  });

  it('needs bio with both spouses and children for the household section', () => {
    const household = item({ sectionKey: 'household' });
    expect(isItemInScope(household, { ...everything, sections: ['bio'] })).toBe(true);
    expect(isItemInScope(household, { ...everything, includeChildren: false })).toBe(false);
  });

  it('needs income, assets and liabilities for a statement item, which does not say which', () => {
    const entry = item({ sectionKey: 'statement:officer', personKey: 'officer', itemId: 'x' });
    expect(
      isItemInScope(entry, { ...everything, sections: ['income', 'assets', 'liabilities'] }),
    ).toBe(true);
    expect(isItemInScope(entry, { ...everything, sections: ['assets', 'liabilities'] })).toBe(
      false,
    );
  });

  it('needs everything for an item on the declaration as a whole', () => {
    expect(isItemInScope(item({}), everything)).toBe(true);
    expect(isItemInScope(item({}), { ...everything, sections: ['bio', 'income'] })).toBe(false);
    expect(isItemInScope(item({}), { ...everything, includeSpouses: false })).toBe(false);
  });
});

describe('disclosedClarification', () => {
  const issued: IssuedClarification = {
    declarationReference: 'DCB-PSC-2027-0000042-7',
    reference: 'CLR-PSC-2027-0000001-3',
    status: 'responded',
    issuedAt: new Date('2027-12-12T09:00:00.000Z'),
    dueAt: new Date('2028-01-11T09:00:00.000Z'),
    respondedAt: new Date('2027-12-20T09:00:00.000Z'),
    responseLate: false,
    resolvedAt: null,
    items: [
      item({ id: 'a', sectionKey: 'statement:officer', personKey: 'officer', text: 'Plot?' }),
      item({ id: 'b', sectionKey: `statement:${SPOUSE}`, personKey: SPOUSE, text: 'Car?' }),
    ],
    letter: {
      commission: { name: 'Public Service Commission', issuerCode: 'PSC' },
      items: [
        {
          label: 'Assets · Plot KSM/123 · James Otieno',
          requirementLabel: 'Explain',
          text: 'Plot?',
        },
        { label: 'Assets · Toyota · Grace Otieno', requirementLabel: 'Provide', text: 'Car?' },
      ],
    },
    response: {
      items: [
        { itemId: 'a', text: 'Revalued in 2027.' },
        { itemId: 'b', text: 'Bought in 2026.' },
      ],
      attachments: [
        { itemId: 'a', uploadId: 'u1', fileName: 'valuation.pdf', sha256: 'a'.repeat(64) },
        { itemId: 'b', uploadId: 'u2', fileName: 'logbook.jpg', sha256: 'b'.repeat(64) },
      ],
    },
  };

  it('gives each item as lettered with its answer and the names of its files', () => {
    expect(disclosedClarification(issued, everything)).toEqual({
      declarationReference: 'DCB-PSC-2027-0000042-7',
      reference: 'CLR-PSC-2027-0000001-3',
      status: 'responded',
      issuedAt: '2027-12-12T09:00:00.000Z',
      dueAt: '2028-01-11T09:00:00.000Z',
      respondedAt: '2027-12-20T09:00:00.000Z',
      responseLate: false,
      resolvedAt: null,
      items: [
        {
          label: 'Assets · Plot KSM/123 · James Otieno',
          requirementLabel: 'Explain',
          text: 'Plot?',
          response: { text: 'Revalued in 2027.', attachmentNames: ['valuation.pdf'] },
        },
        {
          label: 'Assets · Toyota · Grace Otieno',
          requirementLabel: 'Provide',
          text: 'Car?',
          response: { text: 'Bought in 2026.', attachmentNames: ['logbook.jpg'] },
        },
      ],
    });
  });

  it('cuts the items and their answers outside the scope, and leaves out one with none left', () => {
    const officerOnly = { ...everything, includeSpouses: false };
    const cut = disclosedClarification(issued, officerOnly);
    expect(cut?.items.map((each) => each.text)).toEqual(['Plot?']);
    expect(JSON.stringify(cut)).not.toContain('logbook');

    expect(disclosedClarification(issued, { ...officerOnly, sections: ['bio'] })).toBeNull();
  });

  it('gives an unanswered item no response', () => {
    const unanswered = disclosedClarification(
      { ...issued, status: 'overdue', respondedAt: null, response: null },
      everything,
    );
    expect(unanswered?.items.map((each) => each.response)).toEqual([null, null]);
  });
});
