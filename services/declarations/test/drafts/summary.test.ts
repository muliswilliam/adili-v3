import { ATTESTATION_TEXT, declarationIssues } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import { assembleDocument, blockingIssues, cannotSubmitReason } from '../../src/drafts/summary.js';
import {
  bio,
  CHILD_ID,
  household,
  incomeItem,
  other,
  SPOUSE_ID,
  statement,
} from '../fixtures/sections.js';

const FRAME = {
  type: 'biennial',
  statementDate: '2027-11-01',
  incomePeriod: { from: '2025-11-01', to: '2027-11-01', fromSource: 'assumed' },
};

function nilStatement(personKey: string, firstName: string) {
  return {
    ...statement(),
    personKey,
    personName: { surname: 'Otieno', firstName },
    incomeNil: true,
    income: [],
    assetsNil: true,
    assets: [],
  };
}

function sections() {
  return [
    { key: 'bio', contents: bio() },
    { key: 'household', contents: household() },
    { key: 'statement:officer', contents: statement() },
    {
      key: `statement:spouse:${SPOUSE_ID}`,
      contents: nilStatement(`spouse:${SPOUSE_ID}`, 'Grace'),
    },
    { key: `statement:child:${CHILD_ID}`, contents: nilStatement(`child:${CHILD_ID}`, 'Faith') },
    { key: 'other', contents: other() },
  ] as const;
}

describe('assembleDocument', () => {
  it('assembles a valid declaration.v1 document in First Schedule order', () => {
    const document = assembleDocument(FRAME, sections());

    expect(Object.keys(document)).toEqual([
      'schemaVersion',
      'type',
      'statementDate',
      'incomePeriod',
      'officer',
      'spouses',
      'children',
      'statements',
      'otherInformation',
      'attestation',
    ]);
    expect(declarationIssues(document)).toEqual({ issues: [], declaration: [] });
    expect(document.attestation).toEqual({ text: ATTESTATION_TEXT });
    expect((document.statements as { personKey: string }[]).map((s) => s.personKey)).toEqual([
      'officer',
      `spouse:${SPOUSE_ID}`,
      `child:${CHILD_ID}`,
    ]);
  });

  it('composes paragraph 9 from the items, replacing what was stored, ahead of the interests', () => {
    const flagged = {
      ...statement(),
      income: [
        {
          ...incomeItem(),
          change: { changed: true, kind: 'value-change', explanation: 'Promoted' },
        },
      ],
    };
    const document = assembleDocument(FRAME, [
      { key: 'bio', contents: bio() },
      { key: 'statement:officer', contents: flagged },
      {
        key: 'other',
        contents: {
          ...other(),
          freeText: 'Also a church elder',
          materialChanges: [{ kind: 'disposal', explanation: 'Stale' }],
        },
      },
    ]);

    const paragraph9 = document.otherInformation as Record<string, unknown>;
    expect(Object.keys(paragraph9)).toEqual([
      'materialChanges',
      'registrableInterests',
      'freeText',
    ]);
    expect(paragraph9.materialChanges).toEqual([
      {
        personKey: 'officer',
        itemId: incomeItem().id,
        itemDescription: 'Salary',
        kind: 'value-change',
        explanation: 'Promoted',
      },
    ]);
    expect(paragraph9.freeText).toBe('Also a church elder');
  });
});

describe('blockingIssues', () => {
  it('keeps one issue per section and field, the first found', () => {
    const rule = {
      sectionKey: 'household' as const,
      path: '/children',
      code: 'none-or-items-required',
      message: 'Add your dependent children or tick "No dependent children".',
    };
    const schema = { ...rule, code: 'minItems', message: 'must NOT have fewer than 1 items' };
    const other = { sectionKey: 'bio' as const, path: '/birth', code: 'required', message: 'x' };

    expect(blockingIssues([rule], [schema, other])).toEqual([rule, other]);
  });
});

describe('cannotSubmitReason', () => {
  it.each([
    ['2027-10-31', 'before-statement-date'],
    ['2027-11-01', 'submission-not-available'],
    ['2028-01-15', 'submission-not-available'],
  ])('on %s gives %s', (today, reason) => {
    expect(cannotSubmitReason(today, '2027-11-01')).toBe(reason);
  });
});
