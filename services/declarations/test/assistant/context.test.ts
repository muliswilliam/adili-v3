import type { DeclarationIssue } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import { householdCountsOf, MAX_RESIDUALS, residualsOf } from '../../src/assistant/context.js';

/**
 * What Ask Adili tells the gateway about the draft (spec 11 S1): residuals as rule ids and field
 * paths only, and the household as counts. Nothing shaped like a value gets through.
 */

const issue = (overrides: Partial<DeclarationIssue>): DeclarationIssue => ({
  sectionKey: 'statement:officer',
  path: '/assets/0/value',
  code: 'required',
  message: 'Enter the value of Toyota Prado KDA 123A.',
  ...overrides,
});

describe('residualsOf', () => {
  it('keeps the section, rule and path of each issue, never its message', () => {
    expect(residualsOf([issue({})], null)).toEqual([
      { sectionKey: 'statement:officer', ruleId: 'required', fieldPath: '/assets/0/value' },
    ]);
  });

  it('leaves out issues whose path or code could carry a value', () => {
    const residuals = residualsOf(
      [
        issue({ path: '/assets/KDA 123A' }),
        issue({ path: '/assets/0/Toyota' }),
        issue({ path: '/name/12345678x' }),
        issue({ code: 'Otieno owes 4,800,000' }),
        issue({ path: '/assets/01' }),
        issue({ path: '', code: 'section-not-started', sectionKey: 'other' }),
      ],
      null,
    );

    expect(residuals).toEqual([
      { sectionKey: 'other', ruleId: 'section-not-started', fieldPath: '' },
    ]);
  });

  it("puts the current section's residuals first and caps them", () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      issue({ sectionKey: 'bio', path: `/children/${String(index)}/name` }),
    );

    const residuals = residualsOf([...many, issue({})], 'statement:officer');

    expect(residuals).toHaveLength(MAX_RESIDUALS);
    expect(residuals[0]).toMatchObject({ sectionKey: 'statement:officer' });
  });

  it('reports a field once, whichever check found it', () => {
    expect(residualsOf([issue({}), issue({ code: 'minimum' })], null)).toHaveLength(1);
  });
});

describe('householdCountsOf', () => {
  it('reads the counts of the household section, zero when unsaved or malformed', () => {
    expect(householdCountsOf({ counts: { spouses: 1, children: 2 } })).toEqual({
      spouses: 1,
      children: 2,
    });
    expect(householdCountsOf(undefined)).toEqual({ spouses: 0, children: 0 });
    expect(householdCountsOf({ counts: { spouses: -1, children: 1.5 } })).toEqual({
      spouses: 0,
      children: 0,
    });
  });
});
