import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { DeclarationV1 } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import { countVersion } from '../../src/disclosure/counts.js';

/** The counts of a version under an access scope (decision 1), apart from the read. */

const fixture = createRequire(import.meta.url).resolve(
  '@adili/schemas/forms/fixtures/declaration.v1/valid/biennial-household.json',
);
const DOCUMENT = JSON.parse(readFileSync(fixture, 'utf8')) as DeclarationV1;

const entries = (part: 'income' | 'assets' | 'liabilities', persons: (key: string) => boolean) =>
  DOCUMENT.statements
    .filter((statement) => persons(statement.personKey))
    .reduce((sum, statement) => sum + statement[part].length, 0);

describe('countVersion', () => {
  it("counts only the officer's entries when no household member is included", () => {
    const counts = countVersion(DOCUMENT, {
      includeSpouses: false,
      includeChildren: false,
      sections: ['bio', 'income', 'assets', 'liabilities'],
    });
    const officer = (key: string) => key === 'officer';
    expect(counts).toEqual({
      sections: {
        bio: 1,
        income: entries('income', officer),
        assets: entries('assets', officer),
        liabilities: entries('liabilities', officer),
      },
      spouses: null,
      children: null,
    });
  });

  it('counts the included household members anything goes out about, and their entries', () => {
    const counts = countVersion(DOCUMENT, {
      includeSpouses: true,
      includeChildren: true,
      sections: ['assets'],
    });
    expect(counts.sections).toEqual({ assets: entries('assets', () => true) });
    const spouses = DOCUMENT.statements.filter((each) => each.personKey.startsWith('spouse:'));
    expect(counts.spouses?.size).toBe(spouses.length);
    // A child declared but without a statement has nothing in the assets section.
    const children = DOCUMENT.statements.filter((each) => each.personKey.startsWith('child:'));
    expect(counts.children?.size).toBe(children.length);
  });

  it('counts the other information entries and the written statement', () => {
    const other = DOCUMENT.otherInformation;
    const interests = other.registrableInterests;
    const counts = countVersion(DOCUMENT, {
      includeSpouses: true,
      includeChildren: true,
      sections: ['other'],
    });
    expect(counts.sections.other).toBe(
      other.materialChanges.length +
        interests.directorships.length +
        interests.memberships.length +
        interests.pendingCases.length +
        (other.freeText.trim() === '' ? 0 : 1),
    );
  });

  it('counts nothing of a section outside the scope', () => {
    const counts = countVersion(DOCUMENT, {
      includeSpouses: false,
      includeChildren: false,
      sections: ['bio'],
    });
    expect(Object.keys(counts.sections)).toEqual(['bio']);
  });
});
