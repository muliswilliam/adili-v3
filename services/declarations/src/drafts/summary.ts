import {
  ATTESTATION_TEXT,
  type DeclarationIssue,
  type DeclarationSectionKey,
  type PersonKey,
} from '@adili/forms';

import { composeMaterialChanges } from './material-changes.js';
import type { CannotSubmitReason } from './representation.js';
import { type SectionContents, statementPersonKey } from './sections.js';

/**
 * The summary of a draft (spec 05, S11 and S12), pure: the `declaration.v1` document assembled
 * from the live sections, what blocks submission, and why submission is not open. The caller
 * passes only live sections (`liveSections`), so an archived statement never reaches the
 * document or paragraph 9.
 */

/** What the service fixed when the draft started: the document's header fields. */
export interface DocumentFrame {
  type: string;
  statementDate: string;
  incomePeriod: { from: string; to: string; fromSource: string };
}

/** A live section's decrypted contents, in First Schedule order. */
export interface LiveSection {
  key: DeclarationSectionKey;
  contents: SectionContents;
}

/**
 * The `declaration.v1` document in First Schedule order: bio is paragraphs 1-5, household 6 and
 * 7, one statement per live person 8, and paragraph 9 with its material changes composed from
 * the items (never as stored) ahead of the declarant's registrable interests and free text.
 * Items are carried as saved, attachments and 05b `source` included.
 */
export function assembleDocument(
  frame: DocumentFrame,
  sections: readonly LiveSection[],
): Record<string, unknown> {
  let bio: SectionContents = {};
  let household: SectionContents = {};
  let other: SectionContents = {};
  const statements: [PersonKey, SectionContents][] = [];
  for (const { key, contents } of sections) {
    const personKey = statementPersonKey(key);
    if (personKey) statements.push([personKey, contents]);
    else if (key === 'bio') bio = contents;
    else if (key === 'household') household = contents;
    else other = contents;
  }
  // Paragraph 9 as saved, but for the material changes, which are composed here.
  const interests = Object.fromEntries(
    Object.entries(other).filter(([field]) => field !== 'materialChanges'),
  );
  return {
    schemaVersion: 'declaration.v1',
    type: frame.type,
    statementDate: frame.statementDate,
    incomePeriod: { ...frame.incomePeriod },
    officer: bio,
    spouses: household.spouses,
    children: household.children,
    statements: statements.map(([, contents]) => contents),
    otherInformation: {
      materialChanges: composeMaterialChanges({ bio, statements }),
      ...interests,
    },
    attestation: { text: ATTESTATION_TEXT },
  };
}

/**
 * What to complete before submitting: the sections' own issues (schema and rules, as each
 * section reports them), then anything the whole document's validation finds besides. One issue
 * per field: where a rule and the schema speak about the same field, the first found wins.
 */
export function blockingIssues(
  ...found: readonly (readonly DeclarationIssue[])[]
): DeclarationIssue[] {
  const seen = new Set<string>();
  const blocking: DeclarationIssue[] = [];
  for (const issue of found.flat()) {
    const at = `${issue.sectionKey} ${issue.path}`;
    if (seen.has(at)) continue;
    seen.add(at);
    blocking.push(issue);
  }
  return blocking;
}

/**
 * The sections never saved, each blocking as a whole (path `''`): a section the declarant has not
 * saved has not been declared, even when what the draft started it with would validate (paragraph
 * 9 starts empty and valid, yet needs the declarant's own confirmation). In the order given.
 */
export function notStartedIssues(
  sections: readonly { key: DeclarationSectionKey; completeness: string }[],
): DeclarationIssue[] {
  return sections
    .filter((section) => section.completeness === 'not-started')
    .map((section) => ({
      sectionKey: section.key,
      path: '',
      code: 'section-not-started',
      message: 'Open this section, check it and save it.',
    }));
}

/**
 * Why the draft cannot be submitted in this slice: before its statement date nothing can be
 * (compared as Nairobi civil dates), and from it submission opens in the next release.
 */
export function cannotSubmitReason(today: string, statementDate: string): CannotSubmitReason {
  return today < statementDate ? 'before-statement-date' : 'submission-not-available';
}
