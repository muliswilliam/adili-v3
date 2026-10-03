import { type DeclarationSectionKey, type PersonKey, sectionSchema } from '@adili/forms';

import { recordOf } from '../guards.js';
import { fieldErrors } from './problems.js';
import type { SectionMetadata } from './schema.js';

/**
 * Pure rules of a draft's capture sections (spec 05): which keys exist, what a new draft's
 * sections hold, the shape a save must have, and the clear metadata copied out of a section on
 * save. Contents are `declaration.v1` shaped: `bio` is `officer`, `household` is
 * `{ spouses, children }`, `statement:<personKey>` is one `Statement`, `other` is
 * `otherInformation`.
 */

/** declarations.yaml `SectionKey`. */
export const SECTION_KEY =
  /^(bio|household|other|statement:(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36}))$/;

export type SectionContents = Record<string, unknown>;

export function isSectionKey(value: string): value is DeclarationSectionKey {
  return SECTION_KEY.test(value);
}

const STATEMENT_PREFIX = 'statement:';

/** The key of a person's financial statement section. */
export type StatementKey = `statement:${PersonKey}`;

/** A `like` pattern matching every statement section key. */
export const STATEMENT_KEY_PATTERN = `${STATEMENT_PREFIX}%`;

export function statementKey(personKey: PersonKey): StatementKey {
  return `${STATEMENT_PREFIX}${personKey}`;
}

/** Whether the key is a statement's; not a check that it is a well-formed section key. */
export function isStatementKey(key: string): key is StatementKey {
  return key.startsWith(STATEMENT_PREFIX);
}

/** What kind of section a section key names: `statement:<person>` is `statement`. */
export type SectionKind = 'bio' | 'household' | 'statement' | 'other';

export function sectionKind(key: DeclarationSectionKey): SectionKind {
  return isStatementKey(key) ? 'statement' : key;
}

/** Whose statement the section is, or null for a section that is not a statement. */
export function statementPersonKey(key: string): PersonKey | null {
  return isStatementKey(key) ? (key.slice(STATEMENT_PREFIX.length) as PersonKey) : null;
}

/** Bio and household are assessed together (marital status against spouses): each the other's. */
export function siblingSection(key: DeclarationSectionKey): 'bio' | 'household' | null {
  if (key === 'bio') return 'household';
  if (key === 'household') return 'bio';
  return null;
}

/** First Schedule order: bio, household, the statements (the declarant's, then spouses', then children's), other. */
export function sectionRank(key: string): number {
  if (key === 'bio') return 0;
  if (key === 'household') return 1;
  const personKey = statementPersonKey(key);
  if (personKey === 'officer') return 2;
  if (personKey?.startsWith('spouse:')) return 3;
  if (personKey?.startsWith('child:')) return 4;
  return 5;
}

/** What the roster says about the declarant, for the bio's pre-filled fields. */
export interface RosterFacts {
  tenant: string;
  fullName: string;
  personnelFileNumber: string;
  designation: string | null;
  employer: string | null;
  /** The HR fields (spec 05b): pre-filled but editable. */
  jobGroup: string | null;
  appointmentDate: string | null;
  workStation: string | null;
  maritalStatus: string | null;
}

/**
 * Bio as a new draft starts it, from the roster record. Name, reporting entity (`employer`),
 * designation, Commission and personnel file number are locked (identity is fixed at onboarding;
 * the roster is corrected by the Commission, not here); a field the roster leaves empty is not
 * locked, so the declarant can fill it in. Job group, appointment date, work station and marital
 * status (spec 05b) are pre-filled when the roster has them and stay editable; they are listed in
 * `prefilledFields` so the declarant sees where they came from. Both lists are JSON pointers,
 * kept in clear metadata.
 */
export function prefillBio(facts: RosterFacts): {
  contents: SectionContents;
  lockedFields: string[];
  prefilledFields: string[];
} {
  const name = splitFullName(facts.fullName);
  const employment: Record<string, string> = {
    responsibleCommission: facts.tenant,
    personnelFileNumber: facts.personnelFileNumber,
  };
  if (facts.designation) employment.designation = facts.designation;
  if (facts.employer) employment.employer = facts.employer;
  const lockedFields = [
    ...Object.keys(name).map((field) => `/name/${field}`),
    ...Object.keys(employment).map((field) => `/employment/${field}`),
  ];

  const prefilledFields: string[] = [];
  const editable = {
    jobGroup: facts.jobGroup,
    appointmentDate: facts.appointmentDate,
    workStation: facts.workStation,
  };
  for (const [field, value] of Object.entries(editable)) {
    if (!value) continue;
    employment[field] = value;
    prefilledFields.push(`/employment/${field}`);
  }
  const contents: SectionContents = { name, employment };
  if (facts.maritalStatus) {
    contents.maritalStatus = facts.maritalStatus;
    prefilledFields.push('/maritalStatus');
  }
  return { contents, lockedFields, prefilledFields };
}

/**
 * The pre-filled fields (JSON pointers) still holding the roster's value after a save: those the
 * saved contents leave as the stored ones. A field the declarant changes or clears is theirs from
 * then on, even if they later type the roster's value back.
 */
export function keepPrefilledFields(
  prefilledFields: readonly string[],
  saved: SectionContents,
  stored: SectionContents,
): string[] {
  return prefilledFields.filter(
    (pointer) => valueAtPointer(saved, pointer) === valueAtPointer(stored, pointer),
  );
}

/**
 * The roster's one full name as the form's surname, first name and other names: the first word
 * is the first name, the last the surname, any between are other names. A single word is taken
 * as the surname.
 */
export function splitFullName(fullName: string): {
  surname?: string;
  firstName?: string;
  otherNames?: string;
} {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return {};
  if (words.length === 1) return { surname: words[0] };
  const firstName = words[0];
  const surname = words[words.length - 1];
  const middle = words.slice(1, -1).join(' ');
  return middle ? { surname, firstName, otherNames: middle } : { surname, firstName };
}

/** Household as a new draft starts it: nobody listed, nothing answered. */
export function emptyHousehold(): SectionContents {
  return { spouses: { none: false, items: [] }, children: { none: false, items: [] } };
}

/** Paragraph 9 as a new draft starts it. */
export function emptyOther(): SectionContents {
  return {
    materialChanges: [],
    registrableInterests: {
      directorships: [],
      memberships: [],
      dualCitizenship: { holds: false, pendingApplication: false },
      pendingCases: [],
    },
    freeText: '',
  };
}

/** The parts of a statement the service fixes: whose it is and the dates it covers. */
export interface StatementFrame {
  personKey: PersonKey;
  personName: Record<string, unknown>;
  statementDate: string;
  incomePeriod: { from: string; to: string };
}

/** A person's statement as it is created: framed, with no items and no nil answers. */
export function emptyStatement(frame: StatementFrame): SectionContents {
  return {
    ...frame,
    incomeNil: false,
    income: [],
    assetsNil: false,
    assets: [],
    liabilitiesNil: false,
    liabilities: [],
  };
}

export interface ShapeError {
  /** Dotted path within the section contents, as in validation problems. */
  path: string;
  message: string;
}

/**
 * What makes a save's body malformed under the section's `declaration.v1` Zod schema. A draft is
 * saved as the declarant types, so what is merely missing or not yet long enough (a required field
 * absent, a string or list too short, a rule across fields) is not an error here: it is
 * completeness, reported as issues. A value of the wrong type or format, an unknown field, a
 * value out of range or too long is an error: the body is refused.
 */
export function shapeErrors(key: DeclarationSectionKey, body: unknown): ShapeError[] {
  const parsed = sectionSchema(key).safeParse(body);
  if (parsed.success) return [];
  return fieldErrors(
    parsed.error.issues.filter((issue) => {
      if (issue.code === 'custom') return false;
      if (issue.code === 'too_small') return issue.origin !== 'string' && issue.origin !== 'array';
      // Whatever the check, a field that is absent is only missing.
      return valueAt(body, issue.path) !== undefined;
    }),
  );
}

function valueAt(value: unknown, path: readonly PropertyKey[]): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

/** The value at a JSON pointer, e.g. `/employment/designation`. */
export function valueAtPointer(value: unknown, pointer: string): unknown {
  return valueAt(value, pointerSegments(pointer));
}

/** `contents` with `value` at `pointer`, creating objects on the way. */
export function withValueAt(
  contents: SectionContents,
  pointer: string,
  value: unknown,
): SectionContents {
  const segments = pointerSegments(pointer);
  const copy = structuredClone(contents);
  let current: Record<string, unknown> = copy;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  const last = segments[segments.length - 1];
  if (last !== undefined) current[last] = value;
  return copy;
}

function pointerSegments(pointer: string): string[] {
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

/**
 * The locked bio fields the body changes (JSON pointers), and the body with every locked field
 * it leaves out filled in from the stored bio, so that a client need not send them back.
 */
export function applyLockedFields(
  body: SectionContents,
  stored: SectionContents,
  lockedFields: readonly string[],
): { contents: SectionContents; changed: string[] } {
  let contents = body;
  const changed: string[] = [];
  for (const pointer of lockedFields) {
    const kept = valueAtPointer(stored, pointer);
    const sent = valueAtPointer(body, pointer);
    if (sent === undefined) contents = withValueAt(contents, pointer, kept);
    else if (sent !== kept) changed.push(pointer);
  }
  return { contents, changed };
}

/**
 * The registrable interests of paragraph 9 that carry a change flag, the material-change kind
 * each lists as, and the field that names an entry.
 */
export const FLAGGED_INTERESTS = [
  { list: 'directorships', kind: 'directorship', name: 'company' },
  { list: 'memberships', kind: 'membership', name: 'entity' },
] as const;

export const STATEMENT_CATEGORIES = [
  { list: 'income', nil: 'incomeNil' },
  { list: 'assets', nil: 'assetsNil' },
  { list: 'liabilities', nil: 'liabilitiesNil' },
] as const;

/**
 * The categories of a statement declared nil while listing items (S8). Such a save is refused
 * rather than stored: "nothing to declare" and a list cannot both be the answer.
 */
export function nilConflicts(contents: SectionContents): ShapeError[] {
  return STATEMENT_CATEGORIES.filter(
    ({ list, nil }) =>
      contents[nil] === true && Array.isArray(contents[list]) && contents[list].length > 0,
  ).map(({ list }) => ({
    path: list,
    message: `You said there are no ${list} but listed some. Remove them or untick "No ${list}".`,
  }));
}

/**
 * Clear metadata of a section's contents: item counts by category and nil flags for a statement,
 * people listed for the household, interests listed for paragraph 9. Counts and flags only,
 * never values.
 */
export function sectionMetadata(
  key: DeclarationSectionKey,
  contents: SectionContents,
): SectionMetadata {
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  if (statementPersonKey(key)) {
    return {
      counts: {
        income: count(contents.income),
        assets: count(contents.assets),
        liabilities: count(contents.liabilities),
      },
      nil: {
        income: contents.incomeNil === true,
        assets: contents.assetsNil === true,
        liabilities: contents.liabilitiesNil === true,
      },
    };
  }
  if (key === 'household') {
    return {
      counts: {
        spouses: count(recordOf(contents.spouses).items),
        children: count(recordOf(contents.children).items),
      },
    };
  }
  if (key === 'other') {
    const interests = recordOf(contents.registrableInterests);
    return {
      counts: {
        directorships: count(interests.directorships),
        memberships: count(interests.memberships),
        pendingCases: count(interests.pendingCases),
      },
    };
  }
  return {};
}

/** A person's name as one line: first name, other names, surname. */
export function displayName(name: unknown): string | null {
  if (typeof name !== 'object' || name === null) return null;
  const { firstName, otherNames, surname } = name as Record<string, unknown>;
  const parts = [firstName, otherNames, surname].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  return parts.length > 0 ? parts.join(' ') : null;
}
