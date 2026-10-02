import { describe, expect, it } from 'vitest';

import type { ClarificationItem } from '../../src/cases/schema.js';
import { itemLabel } from '../../src/clarifications/labels.js';
import { asset, declaration, statement } from '../fixtures/declarations.js';

const plot = asset({ description: 'Plot in Kisumu' });
const document = declaration([statement('officer', { assets: [plot] })]);

function item(target: Partial<ClarificationItem>): ClarificationItem {
  return {
    id: '0192f1a0-5a11-7000-8000-00000000c001',
    sectionKey: null,
    personKey: null,
    itemId: null,
    requirement: 'explain-discrepancy',
    text: 'Explain.',
    ...target,
  };
}

describe('itemLabel', () => {
  it('names a declared item by category, description and person', () => {
    expect(itemLabel(item({ personKey: 'officer', itemId: plot.id }), document)).toBe(
      'Assets · Plot in Kisumu · James Otieno',
    );
  });

  it("names a person's financial statement", () => {
    expect(itemLabel(item({ sectionKey: 'statement:officer' }), document)).toBe(
      'Financial statement · James Otieno',
    );
    expect(itemLabel(item({ personKey: 'officer' }), document)).toBe(
      'Financial statement · James Otieno',
    );
  });

  it('names a section that is not a statement, even with the person it concerns', () => {
    expect(itemLabel(item({ sectionKey: 'other', personKey: 'officer' }), document)).toBe(
      'Other information',
    );
    expect(itemLabel(item({ sectionKey: 'household' }), document)).toBe('Spouses and children');
  });

  it('falls back to the declaration as a whole', () => {
    expect(itemLabel(item({}), document)).toBe('Declaration');
  });
});
