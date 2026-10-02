import { ATTESTATION_TEXT, type DeclarationV1 } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import { sectionsOfVersion } from '../../src/submission/amendment.js';
import { bio, household, incomeItem, other, statement } from '../fixtures/sections.js';

const promoted = { changed: true, kind: 'value-change', explanation: 'Promoted in 2026.' } as const;

/** A submitted document whose officer and salary say what changed since a last declaration. */
function submitted(type: DeclarationV1['type']): DeclarationV1 {
  return {
    schemaVersion: 'declaration.v1',
    type,
    statementDate: '2027-11-01',
    incomePeriod: { from: '2025-11-01', to: '2027-11-01', fromSource: 'assumed' },
    officer: { ...bio(), maritalStatusChange: { changed: true, explanation: 'Married Grace' } },
    ...household(),
    statements: [{ ...statement(), income: [{ ...incomeItem(), change: promoted }] }],
    otherInformation: other(),
    attestation: { text: ATTESTATION_TEXT },
  };
}

function contentsOf(document: DeclarationV1) {
  return new Map(
    sectionsOfVersion(document, { lockedFields: [] }).map((section) => [
      section.key,
      section.contents,
    ]),
  );
}

describe('sectionsOfVersion', () => {
  it('amends an initial without changes since a last declaration, as it follows none', () => {
    const sections = contentsOf(submitted('initial'));

    expect(sections.get('bio')).toEqual(bio());
    expect(sections.get('statement:officer')).toMatchObject({ income: [incomeItem()] });
  });

  it('amends a biennial with them', () => {
    const document = submitted('biennial');

    const sections = contentsOf(document);

    expect(sections.get('bio')).toEqual(document.officer);
    expect(sections.get('statement:officer')).toMatchObject({
      income: [{ ...incomeItem(), change: promoted }],
    });
  });
});
