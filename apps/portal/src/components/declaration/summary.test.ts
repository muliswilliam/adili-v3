import { describe, expect, it } from 'vitest';

import type { CompletenessIssue, DeclarationSummary } from '../../server/declarations/types';
import {
  blockingGroups,
  blockingTitle,
  childDetails,
  childrenEmptyText,
  issueText,
  itemFlags,
  paragraphCompleteness,
  spouseDetails,
  spousesEmptyText,
  statementTotals,
  SUBMIT_READY,
  submitNote,
  type SummaryDocument,
} from './summary';
import { sections } from './testing';

type CannotSubmitReason = NonNullable<DeclarationSummary['cannotSubmitReason']>;

const SPOUSE = 'statement:spouse:5f0c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f';

function issue(sectionKey: string, message: string): CompletenessIssue {
  return { sectionKey, path: '/x', code: 'required', message };
}

describe('the note beside Submit (S20, spec 06 FE-2)', () => {
  const summary = (cannotSubmitReason: CannotSubmitReason | null, blocking: unknown[] = []) => ({
    cannotSubmitReason,
    blocking,
    declaration: { statementDate: '2027-11-01', dueDate: '2027-12-31' },
  });

  it('says the one-time code comes first when the declaration can be submitted', () => {
    expect(submitNote(summary(null))).toBe(SUBMIT_READY);
    expect(SUBMIT_READY).toBe(
      'You will confirm your identity with a one-time code before submitting.',
    );
  });

  it('says how much is left to complete', () => {
    expect(submitNote(summary('incomplete', [{}, {}, {}]))).toBe(
      'Complete the 3 items listed above to submit.',
    );
    expect(submitNote(summary('incomplete', [{}]))).toBe(
      'Complete the 1 item listed above to submit.',
    );
  });

  it('says when an upcoming obligation can be submitted', () => {
    expect(submitNote(summary('before-statement-date'))).toBe('Available from 1 Nov 2027');
  });

  it('says why a declaration or obligation that takes no submission does not', () => {
    expect(submitNote(summary('not-a-draft'))).toBe('This declaration has already been submitted.');
    expect(submitNote(summary('amendment-window-closed'))).toBe(
      'Amendments closed on 31 Dec 2027. Contact your Commission.',
    );
    expect(submitNote(summary('obligation-cancelled'))).toBe(
      'This declaration is no longer required, so it cannot be submitted. Contact your Commission if you think this is wrong.',
    );
  });
});

describe('blocking issues', () => {
  it('counts the things to complete', () => {
    expect(blockingTitle(1)).toBe('1 thing to complete before you can submit');
    expect(blockingTitle(7)).toBe('7 things to complete before you can submit');
  });

  it('groups issues by section in order and names each section', () => {
    const all = sections({}, [
      { key: SPOUSE, completeness: 'incomplete', updatedAt: null, personName: 'Mary Kamau' },
    ]);
    const { groups, hidden } = blockingGroups(
      [
        issue('bio', 'Enter your date of birth.'),
        issue(SPOUSE, 'Enter the amount.'),
        issue('bio', 'Enter your place of birth.'),
        issue('other', 'Say whether you hold another citizenship.'),
      ],
      all,
    );
    expect(hidden).toBe(0);
    expect(
      groups.map((group) => [group.label, group.issues.map((entry) => entry.message)]),
    ).toEqual([
      ['Your details', ['Enter your date of birth.', 'Enter your place of birth.']],
      ["Mary's financial statement", ['Enter the amount.']],
      ['Other information', ['Say whether you hold another citizenship.']],
    ]);
  });

  it('lists at most twelve and says how many more', () => {
    const many = Array.from({ length: 15 }, (_, index) => issue('bio', `Issue ${String(index)}`));
    const { groups, hidden } = blockingGroups(many, sections());
    expect(groups[0]?.issues).toHaveLength(12);
    expect(hidden).toBe(3);
  });
});

describe('paragraph completeness', () => {
  it('reads a section, and the statements together', () => {
    const all = sections({ bio: 'complete', 'statement:officer': 'complete' }, [
      { key: SPOUSE, completeness: 'incomplete', updatedAt: null, personName: 'Mary Kamau' },
    ]);
    expect(paragraphCompleteness(all, 'bio')).toBe('complete');
    expect(paragraphCompleteness(all, 'household')).toBe('not-started');
    expect(paragraphCompleteness(all, 'statement')).toBe('incomplete');
    expect(paragraphCompleteness(sections({ 'statement:officer': 'complete' }), 'statement')).toBe(
      'complete',
    );
    expect(paragraphCompleteness(sections(), 'statement')).toBe('not-started');
  });
});

describe('household lines', () => {
  it('words a spouse', () => {
    expect(
      spouseDetails({
        nationalId: '12345678',
        kraPin: 'A123456789B',
        occupationSector: 'private',
        separated: true,
        separationDate: '2024-02-01',
      }),
    ).toBe('ID 12345678 · KRA PIN A123456789B · Private sector · Separated since 1 Feb 2024');
    expect(spouseDetails({ separated: false })).toBe('ID not given');
  });

  it('words a child included or not at the statement date', () => {
    expect(
      childDetails({ dateOfBirth: '2012-05-04', includedAtStatementDate: true }, '2027-11-01'),
    ).toBe('Born 4 May 2012 · Included: under 18 on 1 Nov 2027');
    expect(
      childDetails({ dateOfBirth: '2008-01-10', includedAtStatementDate: false }, '2027-11-01'),
    ).toBe('Born 10 Jan 2008 · Not included: 19 on the statement date');
  });

  it('says why there is no spouse or child listed', () => {
    expect(spousesEmptyText({ none: true, items: [] }, 'married')).toBe(
      'Declared: no spouse to declare.',
    );
    expect(spousesEmptyText({}, 'single')).toBe('No spouse to declare.');
    expect(spousesEmptyText(undefined, 'married')).toBe('Not answered yet.');
    expect(childrenEmptyText({ none: true })).toBe('Declared: no dependent children under 18.');
    expect(childrenEmptyText(undefined)).toBe('Not answered yet.');
  });
});

describe('statement lines', () => {
  it('totals each category in cents', () => {
    expect(
      statementTotals({
        income: [{ amount: { kesCents: 100 } }, { amount: { kesCents: 250 } }],
        assets: [{ value: { kesCents: 5000 } }, {}],
        liabilities: [],
      }),
    ).toEqual({ income: 350, assets: 5000, liabilities: 0 });
  });

  it('flags joint shares, foreign amounts and changes', () => {
    expect(
      itemFlags('assets', {
        joint: { isJoint: true, sharePercent: 50 },
        value: { kesCents: 100, original: { currency: 'USD', minorUnits: 125000 } },
        change: { changed: true, kind: 'acquisition' },
      }),
    ).toEqual(['Joint, share 50%', 'Original USD 1,250', 'Changed: acquired']);
    expect(itemFlags('assets', {})).toEqual([]);
  });

  it('names a change the way the editor offered it for the category', () => {
    const acquired = { change: { changed: true, kind: 'acquisition' as const } };
    expect(itemFlags('assets', acquired)).toEqual(['Changed: acquired']);
    expect(itemFlags('liabilities', acquired)).toEqual(['Changed: new']);
    expect(itemFlags('income', { change: { changed: true, kind: 'value-change' } })).toEqual([
      'Changed: value changed',
    ]);
  });
});

describe('issueText', () => {
  const document = {
    statements: [
      {
        personKey: 'officer',
        assets: [{ description: 'One-bedroom apartment, Dubai Marina' }, {}],
      },
    ],
  } as unknown as SummaryDocument;
  const issue = (
    sectionKey: CompletenessIssue['sectionKey'],
    path: string,
    message: string,
  ): CompletenessIssue => ({
    sectionKey,
    path,
    code: 'required',
    message,
  });

  it('names the item and field of a schema check, not "is required / is required"', () => {
    expect(issueText(issue('statement:officer', '/assets/0/value', 'is required'), document)).toBe(
      'One-bedroom apartment, Dubai Marina: Value is required',
    );
    // An item with no description yet is named by its place; a value's amount by its field.
    expect(
      issueText(issue('statement:officer', '/assets/1/value/kesCents', 'is required'), document),
    ).toBe('Asset 2: Value is required');
    expect(
      issueText(issue('household', '/spouses/items/0/separationDate', 'is required'), document),
    ).toBe('Date of separation is required');
    expect(issueText(issue('bio', '/placeOfBirth', 'is required'), document)).toBe(
      'Place of birth is required',
    );
  });

  it('names a field as its screen labels it (Q33)', () => {
    expect(
      issueText(
        issue('statement:officer', '/assets/0/details/parcelNumber', 'is required'),
        document,
      ),
    ).toBe('One-bedroom apartment, Dubai Marina: Parcel or plot number is required');
  });

  it('keeps the rules’ own sentences', () => {
    const sentence = 'Add your dependent children or tick "No dependent children".';
    expect(issueText(issue('household', '/children', sentence), document)).toBe(sentence);
  });
});
