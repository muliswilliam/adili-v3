/**
 * The mock's declaration store and the views of a stored declaration that every part answers
 * with.
 */
import {
  ATTESTATION_TEXT,
  type Draft,
  type Household,
  type Statement,
} from '../../../declaration/contents';
import { sectionKind } from '../../../declaration/section-key';
import type {
  CompletenessIssue,
  Declaration,
  DeclarationAttachment,
  DeclarationSection,
  DeclarationVersion,
} from '../types';
import { bioCompleteness } from './bio';
import type { RuleContext } from './context';
import { fullName, householdCompleteness } from './household';
import { composeMaterialChanges, otherCompleteness } from './other';
import { statementCompleteness } from './statement';
import type { MockFiling } from './submission';
import type { SuggestionState } from './suggestions';

export type Header = Omit<
  Declaration,
  'sections' | 'draftVersion' | 'lastSection' | 'updatedAt' | 'status'
>;

export interface Stored {
  /** The `person_id` of the declarant who started it (null without one); only they see it. */
  owner: string | null;
  header: Header;
  status: Declaration['status'];
  draftVersion: number;
  updatedAt: string;
  lastSection: string | null;
  contents: Map<string, Record<string, unknown>>;
  savedAt: Map<string, string | null>;
  /** Statement keys other than the declarant's own (`statement:officer`), in schedule order, live and archived. */
  persons: string[];
  archived: Set<string>;
  attachments: Map<string, DeclarationAttachment>;
  suggestions: SuggestionState;
  /** The obligation's dates, kept from when the draft was started. */
  filing: MockFiling;
  /** Submitted versions, oldest first. */
  versions: DeclarationVersion[];
  /** What each version filed, by number: its document, and the sections to reopen it from. */
  filed: Map<number, Filed>;
  /** Household started from the declarant's last declaration (story 4), as at its statement date. */
  carriedOverFrom?: { statementDate: string };
}

/** A submitted version's content, kept as the service keeps its immutable snapshot. */
export interface Filed {
  document: Record<string, unknown>;
  sections: Pick<Stored, 'contents' | 'savedAt' | 'persons' | 'archived' | 'attachments'>;
}

export const store = new Map<string, Stored>();

export function etag(stored: Stored) {
  return `"${String(stored.draftVersion)}"`;
}

export function draft(id: string): Stored | undefined {
  const stored = store.get(id);
  return stored && (stored.status === 'draft' || stored.status === 'amending') ? stored : undefined;
}

export function context(stored: Stored, key: string): RuleContext {
  const statements = new Map<string, Draft<Statement>>();
  for (const statementKey of liveStatementKeys(stored)) {
    statements.set(statementKey, stored.contents.get(statementKey) ?? {});
  }
  return {
    key,
    type: stored.header.type,
    statementDate: stored.header.statementDate,
    officer: stored.contents.get('bio') ?? {},
    household: stored.contents.get('household') ?? {},
    statements,
  };
}

export function liveStatementKeys(stored: Stored) {
  return ['statement:officer', ...stored.persons.filter((key) => !stored.archived.has(key))];
}

export function issuesFor(stored: Stored, key: string): CompletenessIssue[] {
  const contents = stored.contents.get(key) ?? {};
  const rules = context(stored, key);
  if (key === 'bio') return bioCompleteness(contents, rules);
  if (key === 'household') return householdCompleteness(contents, rules);
  if (key === 'other') return otherCompleteness(contents, rules);
  return statementCompleteness(contents, rules);
}

export function completeness(stored: Stored, key: string): DeclarationSection['completeness'] {
  if (stored.archived.has(key)) return 'archived';
  if (!stored.savedAt.get(key)) return 'not-started';
  return issuesFor(stored, key).length === 0 ? 'complete' : 'incomplete';
}

export function personName(stored: Stored, key: string): string | null {
  if (sectionKind(key) !== 'statement') return null;
  const statement = stored.contents.get(key) as Draft<Statement> | undefined;
  return fullName(statement?.personName) || null;
}

export function sectionKeys(stored: Stored) {
  return [
    'bio',
    'household',
    ...liveStatementKeys(stored),
    ...stored.persons.filter((key) => stored.archived.has(key)),
    'other',
  ];
}

export function view(stored: Stored): Declaration {
  return {
    ...stored.header,
    status: stored.status,
    draftVersion: stored.draftVersion,
    lastSection: stored.lastSection,
    updatedAt: stored.updatedAt,
    sections: sectionKeys(stored).map((key) => ({
      key,
      completeness: completeness(stored, key),
      updatedAt: stored.savedAt.get(key) ?? null,
      personName: personName(stored, key),
    })),
  };
}

export function percentComplete(stored: Stored) {
  const live = sectionKeys(stored).filter((key) => !stored.archived.has(key));
  const done = live.filter((key) => completeness(stored, key) === 'complete').length;
  return Math.round((done / live.length) * 100);
}

/** The declaration.v1 document assembled from the live sections, as the summary shows it. */
export function documentOf(stored: Stored): Record<string, unknown> {
  const household = (stored.contents.get('household') ?? {}) as Draft<Household>;
  return {
    schemaVersion: 'declaration.v1',
    type: stored.header.type,
    statementDate: stored.header.statementDate,
    incomePeriod: stored.header.incomePeriod,
    officer: stored.contents.get('bio'),
    spouses: household.spouses ?? { none: false, items: [] },
    children: household.children ?? { none: false, items: [] },
    statements: liveStatementKeys(stored).map((key) => stored.contents.get(key)),
    otherInformation: sectionContents(stored, 'other'),
    attestation: { text: ATTESTATION_TEXT },
  };
}

export function sectionContents(stored: Stored, key: string) {
  const contents = stored.contents.get(key) ?? {};
  if (key !== 'other') return contents;
  return { ...contents, materialChanges: composeMaterialChanges(context(stored, key)) };
}
