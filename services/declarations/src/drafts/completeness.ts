import { type DeclarationIssue, type DeclarationSectionKey, sectionIssues } from '@adili/forms';

/**
 * Pure completeness of a draft's capture sections (spec 05, BE-3): the `declaration.v1` schema's
 * issues plus the rules it cannot state (a nil flag against items, marital status against
 * spouses, "none" against a list). Issues have the shape of declarations.yaml
 * `CompletenessIssue`; where a rule and the schema both speak about a field, the rule's code and
 * message win. The client displays completeness, never decides it.
 */

export interface SectionAssessment {
  completeness: 'complete' | 'incomplete';
  issues: DeclarationIssue[];
}

/**
 * Assesses the capture sections given, keyed as a draft stores them. Marital status is checked
 * against spouses only when both `bio` and `household` are given, so a caller saving either
 * passes both. Contents are as saved: possibly partial, never trusted.
 */
export function assessSections(
  sections: ReadonlyMap<DeclarationSectionKey, unknown>,
): Map<DeclarationSectionKey, SectionAssessment> {
  const rules = new Map<DeclarationSectionKey, DeclarationIssue[]>();
  const add = (issue: DeclarationIssue) =>
    rules.set(issue.sectionKey, [...(rules.get(issue.sectionKey) ?? []), issue]);

  for (const [key, contents] of sections) {
    if (key === 'household') householdRules(contents).forEach(add);
    if (key.startsWith('statement:')) statementRules(key, contents).forEach(add);
  }
  // Without bio there is no status to check; an issue on a household not given is dropped below.
  maritalStatusRules(sections.get('bio'), sections.get('household')).forEach(add);

  return new Map(
    [...sections].map(([key, contents]) => {
      const own = rules.get(key) ?? [];
      const ruled = new Set(own.map((issue) => issue.path));
      const found = [
        ...own,
        ...sectionIssues(key, contents).filter((issue) => !ruled.has(issue.path)),
      ];
      return [key, { completeness: found.length === 0 ? 'complete' : 'incomplete', issues: found }];
    }),
  );
}

const CATEGORIES = [
  { list: 'income', nil: 'incomeNil', label: 'income' },
  { list: 'assets', nil: 'assetsNil', label: 'assets' },
  { list: 'liabilities', nil: 'liabilitiesNil', label: 'liabilities' },
] as const;

/** Each category is either declared nil or lists items, never both (S8). */
function statementRules(key: DeclarationSectionKey, contents: unknown): DeclarationIssue[] {
  const statement = record(contents);
  return CATEGORIES.flatMap(({ list, nil, label }) => {
    const items = listOf(statement[list]);
    const path = `/${list}`;
    if (statement[nil] === true && items.length > 0) {
      return [
        issue(
          key,
          path,
          'nil-conflicts-with-items',
          `You said there are no ${label} but listed some. Remove them or untick "No ${label}".`,
        ),
      ];
    }
    if (statement[nil] !== true && items.length === 0) {
      return [issue(key, path, 'nil-or-items-required', `Add ${label} or tick "No ${label}".`)];
    }
    return [];
  });
}

/** "None" is an answer only for an empty list; a separated spouse needs the date (S5, S6). */
function householdRules(contents: unknown): DeclarationIssue[] {
  const { spouses, children } = record(contents);
  const found: DeclarationIssue[] = [];
  for (const [field, noun] of [
    ['spouses', 'no spouse'],
    ['children', 'no dependent children'],
  ] as const) {
    const group = record(field === 'spouses' ? spouses : children);
    if (group.none === true && listOf(group.items).length > 0) {
      found.push(
        issue(
          'household',
          `/${field}/none`,
          'none-conflicts-with-items',
          `You said you have ${noun} but listed some. Remove them or untick "${capitalise(noun)}".`,
        ),
      );
    }
  }
  const childGroup = record(children);
  if (childGroup.none !== true && listOf(childGroup.items).length === 0) {
    found.push(
      issue(
        'household',
        '/children',
        'none-or-items-required',
        'Add your dependent children or tick "No dependent children".',
      ),
    );
  }
  listOf(record(spouses).items).forEach((item, index) => {
    const spouse = record(item);
    if (spouse.separated === true && spouse.separationDate === undefined) {
      found.push(
        issue(
          'household',
          `/spouses/items/${String(index)}/separationDate`,
          'required',
          'is required',
        ),
      );
    }
  });
  return found;
}

/** Statuses with no current spouse; the others (married, separated) need one or "none". */
const WITHOUT_SPOUSE = new Set(['single', 'divorced', 'widowed']);

/** Marital status drives whether spouses are required, and blocks a spouse it rules out (S6). */
function maritalStatusRules(bio: unknown, household: unknown): DeclarationIssue[] {
  const status = record(bio).maritalStatus;
  if (typeof status !== 'string') return [];
  const spouses = record(record(household).spouses);
  const listed = listOf(spouses.items).length;
  if (WITHOUT_SPOUSE.has(status) && listed > 0) {
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
  if (!WITHOUT_SPOUSE.has(status) && listed === 0 && spouses.none !== true) {
    return [
      issue(
        'household',
        '/spouses',
        'spouse-required',
        `Add your spouse or tick "No spouse"; Bio data says you are ${status}.`,
      ),
    ];
  }
  return [];
}

function issue(
  sectionKey: DeclarationSectionKey,
  path: string,
  code: string,
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

function capitalise(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
