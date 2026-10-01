import type { DeclarationSectionKey, DeclarationV1, PersonKey } from '@adili/forms';

import { attachmentRefs, type AttachmentRef } from '../drafts/attachments.js';
import { assessSections } from '../drafts/completeness.js';
import { householdPeople } from '../drafts/household.js';
import type { SectionCompleteness, SectionMetadata } from '../drafts/schema.js';
import {
  type SectionContents,
  sectionMetadata,
  statementKey,
  type StatementKey,
} from '../drafts/sections.js';

/**
 * Amendments (spec 06), pure: a submitted version's `declaration.v1` document back as the
 * editable sections it was assembled from (the inverse of `assembleDocument`), and the attachment
 * links the version's items hold.
 */

/** A section as a version's document gives it, ready to seal and store. */
export interface SectionFromVersion {
  key: DeclarationSectionKey;
  contents: SectionContents;
  completeness: SectionCompleteness;
  metadata: SectionMetadata;
}

/**
 * The capture sections of a submitted document, in First Schedule order: bio is the declarant
 * (`officer` in declaration.v1), household the spouses and children, one statement per person,
 * other the paragraph 9 information. Each is assessed as a save would (a submitted document is
 * complete, unless a rule has changed since), with the clear metadata a save derives; the bio
 * keeps the fields the roster locked (`lockedFields`, from the draft that was submitted).
 */
export function sectionsOfVersion(
  document: DeclarationV1,
  { lockedFields }: { lockedFields: string[] },
): SectionFromVersion[] {
  const bio = document.officer as unknown as SectionContents;
  const household: SectionContents = { spouses: document.spouses, children: document.children };
  const statements = new Map<PersonKey, SectionContents>(
    document.statements.map((statement) => [
      // declaration.v1 keys each statement by one person, as its section is.
      statement.personKey as PersonKey,
      statement as unknown as SectionContents,
    ]),
  );
  const other = document.otherInformation as unknown as SectionContents;
  const assessed = assessSections({ bio, household, statements, other });
  const section = (
    key: DeclarationSectionKey,
    contents: SectionContents,
    metadata: SectionMetadata = {},
  ): SectionFromVersion => ({
    key,
    contents,
    completeness: assessed.get(key)?.completeness ?? 'incomplete',
    metadata: { ...sectionMetadata(key, contents), ...metadata },
  });
  return [
    section('bio', bio, lockedFields.length > 0 ? { lockedFields } : {}),
    section('household', household, {
      notIncluded: householdPeople(household, document.statementDate).notIncluded,
    }),
    ...[...statements].map(([personKey, contents]) => section(statementKey(personKey), contents)),
    section('other', other),
  ];
}

/** An attachment link a version's item holds: which statement, which item, which upload. */
export interface VersionAttachment {
  sectionKey: StatementKey;
  itemId: string;
  ref: AttachmentRef;
}

/** Every attachment reference in the version's statements. */
export function attachmentsOfVersion(sections: readonly SectionFromVersion[]): VersionAttachment[] {
  return sections.flatMap((section) =>
    section.key.startsWith('statement:')
      ? attachmentRefs(section.contents).map(({ itemId, ref }) => ({
          sectionKey: section.key as StatementKey,
          itemId,
          ref,
        }))
      : [],
  );
}
