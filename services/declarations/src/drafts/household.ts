import type { PersonKey } from '@adili/forms';

import { isRecord, isUuid } from '../guards.js';
import { type ChildExclusion, childInclusion, type IsoDate } from './derive.js';
import type { SectionContents } from './sections.js';

/**
 * Pure rules of the household section (paragraphs 6-7) and the financial statements it sets up
 * (paragraph 8, spec 05 S5): who needs a statement, and how the statements stored so far must
 * change when the household is saved. Nothing is deleted before discard: a person taken out of
 * the household has their statement archived, and it is restored if they come back.
 */

/** A person of the household who needs a financial statement, with the name to put on it. */
export interface StatementPerson {
  personKey: Exclude<PersonKey, 'officer'>;
  personName: unknown;
}

/** A child left out of the statements, as the household section reports it. */
export interface NotIncluded {
  personKey: `child:${string}`;
  reason: ChildExclusion['reason'];
}

export interface HouseholdPeople {
  /** The contents to store: each dated child's `includedAtStatementDate` derived, never taken. */
  contents: SectionContents;
  /** Every spouse, and every child under eighteen on the statement date, in the order listed. */
  statements: StatementPerson[];
  notIncluded: NotIncluded[];
}

/**
 * Who in a household (as saved, possibly partial) needs a statement. Every listed spouse does,
 * separated or not, whatever the marital status says (a conflict there is completeness, not a
 * reason to drop a statement). A child does when under eighteen on the statement date; a child
 * with no date of birth yet is neither included nor excluded until it is given, and a person
 * with no id yet has nothing to key a statement by.
 */
export function householdPeople(
  contents: SectionContents,
  statementDate: IsoDate,
): HouseholdPeople {
  const statements: StatementPerson[] = [];
  const notIncluded: NotIncluded[] = [];
  const spouses = record(contents.spouses);
  const spouseItems = listOf(spouses.items).map((item) => {
    const spouse = withLowerCaseId(item);
    if (isId(spouse.id)) {
      statements.push({ personKey: `spouse:${spouse.id}`, personName: spouse.name });
    }
    return spouse;
  });
  const children = record(contents.children);
  const childItems = listOf(children.items).map((item) => {
    const child = withLowerCaseId(item);
    delete child.includedAtStatementDate;
    if (typeof child.dateOfBirth !== 'string') return child;
    const inclusion = childInclusion(child.dateOfBirth, statementDate);
    if (isId(child.id)) {
      if (inclusion.included) {
        statements.push({ personKey: `child:${child.id}`, personName: child.name });
      } else {
        notIncluded.push({ personKey: `child:${child.id}`, reason: inclusion.reason });
      }
    }
    return { ...child, includedAtStatementDate: inclusion.included };
  });
  const derived = { ...contents };
  if (Array.isArray(spouses.items)) derived.spouses = { ...spouses, items: spouseItems };
  if (Array.isArray(children.items)) derived.children = { ...children, items: childItems };
  return { contents: derived, statements, notIncluded };
}

/** A copy of the listed person, its id in lower case like the section keys made of it. */
function withLowerCaseId(item: unknown): Record<string, unknown> {
  const person = { ...record(item) };
  if (typeof person.id === 'string') person.id = person.id.toLowerCase();
  return person;
}

/** The household's person ids listed more than once, as validation errors. */
export function duplicatePeople(contents: SectionContents): { path: string; message: string }[] {
  return (['spouses', 'children'] as const).flatMap((list) => {
    const seen = new Set<string>();
    return listOf(record(contents[list]).items).flatMap((item, index) => {
      const id = record(item).id;
      if (!isId(id)) return [];
      const key = id.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        return [];
      }
      return [{ path: `${list}.items.${String(index)}.id`, message: 'Listed twice' }];
    });
  });
}

/** A person's statement as stored: whether it is archived. */
export interface StoredStatement {
  personKey: PersonKey;
  archived: boolean;
}

export interface StatementPlan {
  /** People with no statement yet: create an empty one. */
  create: StatementPerson[];
  /** Archived statements of people back in the household: restore them. */
  restore: StatementPerson[];
  /** Live statements of people still in the household: keep, with the name brought up to date. */
  keep: StatementPerson[];
  /** Live statements of people no longer in the household (or no longer included): archive. */
  archive: PersonKey[];
}

/** How the stored statements change for a household that needs `wanted`. The officer's stays. */
export function planStatements(
  wanted: readonly StatementPerson[],
  stored: readonly StoredStatement[],
): StatementPlan {
  const byKey = new Map(stored.map((statement) => [statement.personKey, statement]));
  const wantedKeys = new Set<PersonKey>(wanted.map((person) => person.personKey));
  const plan: StatementPlan = { create: [], restore: [], keep: [], archive: [] };
  for (const person of wanted) {
    const existing = byKey.get(person.personKey);
    if (!existing) plan.create.push(person);
    else if (existing.archived) plan.restore.push(person);
    else plan.keep.push(person);
  }
  for (const statement of stored) {
    if (statement.personKey === 'officer' || statement.archived) continue;
    if (!wantedKeys.has(statement.personKey)) plan.archive.push(statement.personKey);
  }
  return plan;
}

/** A person's id, lower case as their statement's section key must be. */
function isId(value: unknown): value is string {
  return isUuid(value) && value === value.toLowerCase();
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
