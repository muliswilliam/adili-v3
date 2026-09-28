import type { PersonKey } from './contents';

/**
 * Section keys, parsed and built in one place: `bio`, `household`, `other`, or
 * `statement:<personKey>`, where the person key is `officer`, `spouse:<uuid>` or
 * `child:<uuid>`. The contract types a key as a plain string (its pattern only checks the
 * id's length); here the id must be a lowercase canonical UUID, the same rule for the server
 * functions, the routes, the workspace and the mock backend.
 */

export type SectionKind = 'bio' | 'household' | 'statement' | 'other';

export type ParsedSectionKey =
  { kind: 'bio' | 'household' | 'other' } | { kind: 'statement'; personKey: PersonKey };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PERSON_KEY = new RegExp(`^(?:officer|(?:spouse|child):${UUID})$`);
const STATEMENT = 'statement:';

/** `officer`, `spouse:<uuid>` or `child:<uuid>`; null for anything else. */
export function parsePersonKey(value: string): PersonKey | null {
  return PERSON_KEY.test(value) ? (value as PersonKey) : null;
}

export function parseSectionKey(key: string): ParsedSectionKey | null {
  if (key === 'bio' || key === 'household' || key === 'other') return { kind: key };
  if (!key.startsWith(STATEMENT)) return null;
  const personKey = parsePersonKey(key.slice(STATEMENT.length));
  return personKey ? { kind: 'statement', personKey } : null;
}

export function isSectionKey(key: string): boolean {
  return parseSectionKey(key) !== null;
}

/** The statement section of a person: `officer` -> `statement:officer`. */
export function statementSectionKey(personKey: PersonKey): string {
  return `${STATEMENT}${personKey}`;
}

/** Null for a key that is not a section's. */
export function sectionKind(key: string): SectionKind | null {
  return parseSectionKey(key)?.kind ?? null;
}

/** `statement:spouse:<uuid>` -> `spouse:<uuid>`; null for other sections. */
export function personKeyOf(key: string): PersonKey | null {
  const parsed = parseSectionKey(key);
  return parsed?.kind === 'statement' ? parsed.personKey : null;
}

/** Whose statement a key is: the officer, a spouse or a child; null for other sections. */
export function relationOf(key: string): 'officer' | 'spouse' | 'child' | null {
  const personKey = personKeyOf(key);
  if (personKey === null) return null;
  if (personKey === 'officer') return 'officer';
  return personKey.startsWith('spouse:') ? 'spouse' : 'child';
}
