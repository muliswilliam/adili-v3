import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { problemCounts, sourceRefProblems } from '../../src/policy/source-refs.js';
import { explainInput, FLAG_ID } from '../support/inputs.js';

const document = JSON.parse(
  readFileSync(
    new URL(
      '../../../../packages/schemas/forms/fixtures/declaration.v1/valid/biennial-household.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as Record<string, unknown>;

const OFFICER = 'officer';
const SPOUSE = 'spouse:0192f1a0-5a11-7000-8000-000000000101';
const VEHICLE = '0192f1a0-5a11-7000-8000-000000002003';
const ref = (
  parts: Partial<Record<'sectionKey' | 'personKey' | 'itemId' | 'fieldPath', string>>,
) => ({
  sectionKey: null,
  personKey: null,
  itemId: null,
  fieldPath: null,
  ...parts,
});
const summarize = { document, previousDocument: null, flags: [] };

describe('sourceRefProblems (spec 07c S4)', () => {
  it('accepts refs that resolve against a declaration in the input', () => {
    const output = {
      sections: [
        {
          refs: [
            ref({ sectionKey: `statement:${OFFICER}`, personKey: OFFICER, itemId: VEHICLE }),
            ref({ sectionKey: 'household', fieldPath: '/spouses/items/1' }),
            ref({}),
          ],
        },
      ],
    };

    expect(sourceRefProblems(summarize, output)).toEqual([]);
  });

  it.each([
    ['an item not in the input', ref({ itemId: '0192f1a0-5a11-7000-8000-00000000ffff' })],
    ['a person not in the input', ref({ personKey: 'child:0192f1a0-5a11-7000-8000-000000000999' })],
    ['a section not in the input', ref({ sectionKey: 'statement:nobody' })],
    ['a field path leading nowhere', ref({ fieldPath: '/statements/99/assets/0' })],
    ['an item paired with the wrong person', ref({ personKey: SPOUSE, itemId: VEHICLE })],
    ['an item in the wrong section', ref({ sectionKey: `statement:${SPOUSE}`, itemId: VEHICLE })],
  ])('rejects %s', (_case, bad) => {
    expect(sourceRefProblems(summarize, { refs: [bad] })).toHaveLength(1);
  });

  it('accepts refs the input carries, and rejects others, when the input has no document', () => {
    const [flag] = explainInput.flags;
    const given = flag?.itemRefs[0];

    expect(
      sourceRefProblems(explainInput, { explanations: [{ flagId: FLAG_ID, refs: [given] }] }),
    ).toEqual([]);
    expect(
      sourceRefProblems(explainInput, {
        explanations: [
          { flagId: FLAG_ID, refs: [{ ...given, itemId: '0199a8f0-1111-7000-8000-00000000ffff' }] },
        ],
      }),
    ).toHaveLength(1);
  });

  it('counts problems by code, never quoting what the model wrote', () => {
    const problems = sourceRefProblems(explainInput, {
      explanations: [{ flagId: 'Grace Otieno', refs: [] }],
      refs: [{ sectionKey: null, personKey: 'Grace', itemId: null, fieldPath: null }],
    });

    expect(problemCounts(problems)).toEqual({ 'unknown-flag': 1, 'unknown-ref': 1 });
  });

  it('rejects flag ids the input does not hold', () => {
    const unknown = '0199a8f0-2222-7000-8000-00000000ffff';

    expect(
      sourceRefProblems(explainInput, { explanations: [{ flagId: unknown, refs: [] }] }),
    ).toEqual([{ code: 'unknown-flag', message: `flag ${unknown} is not in the input` }]);
    expect(
      sourceRefProblems(explainInput, { worthAttention: [{ flagIds: [FLAG_ID, unknown] }] }),
    ).toEqual([{ code: 'unknown-flag', message: `flag ${unknown} is not in the input` }]);
  });
});
