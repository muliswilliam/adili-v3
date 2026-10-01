import {
  type DeclarationIssue,
  type DeclarationSectionKey,
  type PersonKey,
  sectionIssues,
} from '@adili/forms';

import { recordOf } from '../guards.js';
import { FLAGGED_INTERESTS, statementKey } from './sections.js';

/**
 * Pure completeness of a draft's capture sections (spec 05, BE-3): the `declaration.v1` schema's
 * issues plus the rules it cannot state (a nil flag against items, marital status against
 * spouses, "none" against a list). Issues have the shape of declarations.yaml
 * `CompletenessIssue`; where a rule and the schema both speak about a field, the rule's code and
 * message win. The client displays completeness, never decides it.
 *
 * What stays with the caller: leaving archived statements out, reporting a never-saved section as
 * `not-started`, and refusing a save with `nil-conflicts-with-items` as a 400 (S8) rather than
 * storing it.
 */

/**
 * The codes the rules report beside the schema's own. `required` is the schema keyword, reused for
 * the one field the schema cannot require: a separated spouse's separation date.
 */
export type RuleCode =
  | 'nil-conflicts-with-items'
  | 'nil-or-items-required'
  | 'none-conflicts-with-items'
  | 'none-or-items-required'
  | 'spouse-required'
  | 'spouse-conflicts-with-marital-status'
  | 'required';

export interface SectionAssessment {
  completeness: 'complete' | 'incomplete';
  issues: DeclarationIssue[];
}

/**
 * A draft's live capture sections as saved: possibly partial, never trusted. Bio and household
 * are always needed because marital status is checked against spouses whichever is saved.
 */
export interface DraftSections {
  bio: unknown;
  household: unknown;
  statements?: ReadonlyMap<PersonKey, unknown>;
  other?: unknown;
}

/** Assesses each capture section given, in capture order. */
export function assessSections(
  draft: DraftSections,
): Map<DeclarationSectionKey, SectionAssessment> {
  const status = maritalStatus(draft.bio);
  const paired = spouseConflict(status, draft.household);
  const pairedOn = (key: DeclarationSectionKey) =>
    paired.filter((found) => found.sectionKey === key);
  const sections: [DeclarationSectionKey, unknown, DeclarationIssue[]][] = [
    ['bio', draft.bio, pairedOn('bio')],
    [
      'household',
      draft.household,
      [...householdRules(draft.household, status), ...pairedOn('household')],
    ],
  ];
  for (const [personKey, contents] of draft.statements ?? []) {
    const key = statementKey(personKey);
    sections.push([key, contents, statementRules(key, contents)]);
  }
  if (draft.other !== undefined) sections.push(['other', draft.other, interestRules(draft.other)]);

  return new Map(
    sections.map(([key, contents, rules]) => {
      // A rule replaces every schema issue on its path, whatever the keyword: the rule's message
      // is the one that says what to do (a malformed /spouses shows as spouse-required too).
      const ruled = new Set(rules.map((issue) => issue.path));
      const found = [
        ...rules,
        ...sectionIssues(key, contents).filter((issue) => !ruled.has(issue.path)),
      ];
      return [key, { completeness: found.length === 0 ? 'complete' : 'incomplete', issues: found }];
    }),
  );
}

interface Finding {
  path: string;
  code: RuleCode;
  message: string;
}

/** A flag that says "nothing to list" (nil, none) and the list it answers for. */
interface Presence {
  flagged: boolean;
  items: number;
  /** Flag set and items listed. */
  conflict: Finding;
  /** Neither flag nor items; absent where an empty list is a fine answer. */
  missing?: Finding;
}

/** The flag must match the list: never both and, where an answer is needed, not neither. */
function presenceRule(key: DeclarationSectionKey, rule: Presence): DeclarationIssue[] {
  const found =
    rule.flagged && rule.items > 0
      ? rule.conflict
      : !rule.flagged && rule.items === 0
        ? rule.missing
        : undefined;
  return found ? [issue(key, found.path, found.code, found.message)] : [];
}

const CATEGORIES = [
  { list: 'income', nil: 'incomeNil' },
  { list: 'assets', nil: 'assetsNil' },
  { list: 'liabilities', nil: 'liabilitiesNil' },
] as const;

/**
 * Each category is either declared nil or lists items, never both (S8); an item flagged as
 * changed since the last declaration says what kind of change and explains it (S9).
 */
function statementRules(key: DeclarationSectionKey, contents: unknown): DeclarationIssue[] {
  const statement = recordOf(contents);
  const nilRules = CATEGORIES.flatMap(({ list, nil }) =>
    presenceRule(key, {
      flagged: statement[nil] === true,
      items: listOf(statement[list]).length,
      conflict: {
        path: `/${list}`,
        code: 'nil-conflicts-with-items',
        message: `You said there are no ${list} but listed some. Remove them or untick "No ${list}".`,
      },
      missing: {
        path: `/${list}`,
        code: 'nil-or-items-required',
        message: `Add ${list} or tick "No ${list}".`,
      },
    }),
  );
  const changes = CATEGORIES.flatMap(({ list }) =>
    listOf(statement[list]).flatMap((item, index) =>
      changeRules(key, `/${list}/${String(index)}/change`, recordOf(item).change),
    ),
  );
  return [...nilRules, ...changes];
}

/** A directorship or membership flagged as changed since the last declaration, as an item (S9). */
function interestRules(contents: unknown): DeclarationIssue[] {
  const interests = recordOf(recordOf(contents).registrableInterests);
  return FLAGGED_INTERESTS.flatMap(({ list }) =>
    listOf(interests[list]).flatMap((interest, index) =>
      changeRules(
        'other',
        `/registrableInterests/${list}/${String(index)}/change`,
        recordOf(interest).change,
      ),
    ),
  );
}

/** A change flag that is set says what kind of change it was and explains it. */
function changeRules(key: DeclarationSectionKey, at: string, value: unknown): DeclarationIssue[] {
  const change = recordOf(value);
  if (change.changed !== true) return [];
  return [
    ...(filled(change.kind)
      ? []
      : [issue(key, `${at}/kind`, 'required', 'Choose what changed since your last declaration.')]),
    ...(filled(change.explanation)
      ? []
      : [
          issue(
            key,
            `${at}/explanation`,
            'required',
            'Explain what changed since your last declaration.',
          ),
        ]),
  ];
}

/** A string with something in it besides spaces. */
function filled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Statuses with no current spouse; the others (married, separated) need one or "none". */
const WITHOUT_SPOUSE = new Set(['single', 'divorced', 'widowed']);

/** The marital status bio holds, if it holds one. */
function maritalStatus(bio: unknown): string | undefined {
  const status = recordOf(bio).maritalStatus;
  return typeof status === 'string' ? status : undefined;
}

/**
 * "None" is an answer only for an empty list, children need one or the other, and spouses do
 * when marital status says there is one (S5, S6). A separated spouse needs the date.
 */
function householdRules(contents: unknown, status: string | undefined): DeclarationIssue[] {
  const household = recordOf(contents);
  const spouses = recordOf(household.spouses);
  const children = recordOf(household.children);
  const needsSpouse = status !== undefined && !WITHOUT_SPOUSE.has(status);
  return [
    ...presenceRule('household', {
      flagged: spouses.none === true,
      items: listOf(spouses.items).length,
      conflict: {
        path: '/spouses/none',
        code: 'none-conflicts-with-items',
        message: 'You said you have no spouse but listed one. Remove them or untick "No spouse".',
      },
      ...(needsSpouse && {
        missing: {
          path: '/spouses',
          code: 'spouse-required',
          message: `Add your spouse or tick "No spouse"; Bio data says you are ${status}.`,
        },
      }),
    }),
    ...presenceRule('household', {
      flagged: children.none === true,
      items: listOf(children.items).length,
      conflict: {
        path: '/children/none',
        code: 'none-conflicts-with-items',
        message:
          'You said you have no dependent children but listed some. Remove them or untick "No dependent children".',
      },
      missing: {
        path: '/children',
        code: 'none-or-items-required',
        message: 'Add your dependent children or tick "No dependent children".',
      },
    }),
    ...listOf(spouses.items).flatMap((item, index) => {
      const spouse = recordOf(item);
      return spouse.separated === true && spouse.separationDate === undefined
        ? [
            issue(
              'household',
              `/spouses/items/${String(index)}/separationDate`,
              'required',
              'is required',
            ),
          ]
        : [];
    }),
  ];
}

/** A status with no current spouse blocks a listed spouse, with a message on each side (S6). */
function spouseConflict(status: string | undefined, household: unknown): DeclarationIssue[] {
  const listed = listOf(recordOf(recordOf(household).spouses).items).length;
  if (status === undefined || !WITHOUT_SPOUSE.has(status) || listed === 0) return [];
  const code = 'spouse-conflicts-with-marital-status';
  return [
    issue(
      'bio',
      '/maritalStatus',
      code,
      `You said you are ${status}, but Spouses and children lists a spouse.`,
    ),
    issue(
      'household',
      '/spouses/items',
      code,
      `You listed a spouse, but Bio data says you are ${status}.`,
    ),
  ];
}

function issue(
  sectionKey: DeclarationSectionKey,
  path: string,
  code: RuleCode,
  message: string,
): DeclarationIssue {
  return { sectionKey, path, code, message };
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
