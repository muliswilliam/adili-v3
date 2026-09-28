import {
  type DeclarationIssue,
  type DeclarationSectionKey,
  type PersonKey,
  sectionIssues,
} from '@adili/forms';

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

/** The codes the rules add to the schema's own (`required`, `pattern`, `minItems`...). */
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
  const paired = spouseConflict(draft.bio, draft.household);
  const pairedOn = (key: DeclarationSectionKey) =>
    paired.filter((found) => found.sectionKey === key);
  const sections: [DeclarationSectionKey, unknown, DeclarationIssue[]][] = [
    ['bio', draft.bio, pairedOn('bio')],
    [
      'household',
      draft.household,
      [...householdRules(draft.household, draft.bio), ...pairedOn('household')],
    ],
  ];
  for (const [personKey, contents] of draft.statements ?? []) {
    const key = `statement:${personKey}` as const;
    sections.push([key, contents, statementRules(key, contents)]);
  }
  if (draft.other !== undefined) sections.push(['other', draft.other, []]);

  return new Map(
    sections.map(([key, contents, rules]) => {
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

/** Each category is either declared nil or lists items, never both (S8). */
function statementRules(key: DeclarationSectionKey, contents: unknown): DeclarationIssue[] {
  const statement = record(contents);
  return CATEGORIES.flatMap(({ list, nil }) =>
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
}

/** Statuses with no current spouse; the others (married, separated) need one or "none". */
const WITHOUT_SPOUSE = new Set(['single', 'divorced', 'widowed']);

/**
 * "None" is an answer only for an empty list, children need one or the other, and spouses do
 * when marital status says there is one (S5, S6). A separated spouse needs the date.
 */
function householdRules(contents: unknown, bio: unknown): DeclarationIssue[] {
  const household = record(contents);
  const spouses = record(household.spouses);
  const children = record(household.children);
  const status = record(bio).maritalStatus;
  const needsSpouse = typeof status === 'string' && !WITHOUT_SPOUSE.has(status);
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
      const spouse = record(item);
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
function spouseConflict(bio: unknown, household: unknown): DeclarationIssue[] {
  const status = record(bio).maritalStatus;
  const listed = listOf(record(record(household).spouses).items).length;
  if (typeof status !== 'string' || !WITHOUT_SPOUSE.has(status) || listed === 0) return [];
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

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
