import { countryName, formatNumber } from '@adili/ui';

import type { Draft, MaterialChangeEntry, OtherInformation } from './contents';
import { UNANSWERED } from './format';
import { CHANGE_KIND_WORDS, interestChangeWord, MEMBERSHIP_KIND_LABELS } from './labels';

/**
 * Paragraph 9 (other information) as words: the auto-composed material changes and the
 * registrable interests, shared by the Other information screen and the summary.
 */

export const NO_MATERIAL_CHANGES = 'No changes flagged on your items or interests.';
export const FREE_TEXT_LIMIT = 4000;

/** Paragraph 9's registrable interests, as drafted. */
export type Interests = NonNullable<Draft<OtherInformation>['registrableInterests']>;
export type DraftDirectorship = NonNullable<Interests['directorships']>[number];
export type DraftMembership = NonNullable<Interests['memberships']>[number];
export type DraftPendingCase = NonNullable<Interests['pendingCases']>[number];
export type DraftDualCitizenship = NonNullable<Interests['dualCitizenship']>;

const KIND_WORDS: Record<MaterialChangeEntry['kind'], string> = {
  ...CHANGE_KIND_WORDS,
  'marital-status': 'marital status changed',
  directorship: 'directorship changed',
  membership: 'membership changed',
};

/** What changed, in a sentence: "value changed", "marital status changed". */
export function changeKindWords(kind: MaterialChangeEntry['kind'] | undefined): string {
  return kind ? KIND_WORDS[kind] : 'changed';
}

/** The thing that changed: the item's description, or "Marital status". */
function changedThing(entry: Draft<MaterialChangeEntry>): string {
  if (entry.kind === 'marital-status') return 'Marital status';
  return entry.itemDescription?.trim() ? entry.itemDescription.trim() : 'An item';
}

export interface MaterialChangeParts {
  person: string;
  thing: string;
  kind: string;
  explanation: string;
}

/** The pieces of "{Person} · {item description}: {kind} · {explanation}". */
export function materialChangeParts(
  entry: Draft<MaterialChangeEntry>,
  personLabel: (personKey: string) => string,
): MaterialChangeParts {
  return {
    person: personLabel(entry.personKey ?? 'officer'),
    thing: changedThing(entry),
    kind: changeKindWords(entry.kind),
    explanation: entry.explanation?.trim() ?? '',
  };
}

/** "{Person} · {item description}: {kind} · {explanation}", as the spec composes it. */
export function materialChangeLine(
  entry: Draft<MaterialChangeEntry>,
  personLabel: (personKey: string) => string,
): string {
  const parts = materialChangeParts(entry, personLabel);
  const head = `${parts.person} · ${parts.thing}: ${parts.kind}`;
  return parts.explanation ? `${head} · ${parts.explanation}` : head;
}

/**
 * The workspace step where a material change is edited: the person's statement, the bio, or
 * other information for a directorship or membership.
 */
export function materialChangeStep(entry: Draft<MaterialChangeEntry>): string {
  if (entry.kind === 'marital-status') return 'bio';
  if (entry.kind === 'directorship' || entry.kind === 'membership') return 'other';
  return `statement:${entry.personKey ?? 'officer'}`;
}

/** An answer inside a line: the text, or "{what} not answered" (the first part says UNANSWERED). */
function part(value: string | undefined, what: string | null): string {
  if (value?.trim()) return value.trim();
  return what ? `${what} not answered` : UNANSWERED;
}

function yesNo(value: boolean | undefined) {
  if (value === undefined) return 'not answered';
  return value ? 'yes' : 'no';
}

/** " · Changed: {kind}" for an interest flagged as changed, as a statement item's flags say. */
function changedSuffix(entry: DraftDirectorship | DraftMembership): string {
  if (!entry.change?.changed) return '';
  return entry.change.kind ? ` · Changed: ${interestChangeWord(entry.change.kind)}` : ' · Changed';
}

/** "{company}, {role} (paid|unpaid)", naming any part not answered, then any change. */
export function directorshipLine(entry: DraftDirectorship): string {
  const paid =
    entry.remunerated === undefined ? 'pay not answered' : entry.remunerated ? 'paid' : 'unpaid';
  return `${part(entry.company, null)}, ${part(entry.role, 'role')} (${paid})${changedSuffix(entry)}`;
}

/** "{entity} ({Kind})", then any change. */
export function membershipLine(entry: DraftMembership): string {
  const kind = entry.kind ? MEMBERSHIP_KIND_LABELS[entry.kind] : 'kind not answered';
  return `${part(entry.entity, null)} (${kind})${changedSuffix(entry)}`;
}

/** "{court}, {reference}: {nature}". */
export function pendingCaseLine(entry: DraftPendingCase): string {
  return `${part(entry.forum, null)}, ${part(entry.reference, 'reference')}: ${part(entry.nature, 'nature')}`;
}

/** "Yes, Uganda · pending application: no", "No · pending application: yes", "Not answered". */
export function dualCitizenshipLine(dual: DraftDualCitizenship | undefined): string {
  if (dual?.holds === undefined && dual?.pendingApplication === undefined) return UNANSWERED;
  const holds =
    dual.holds === undefined
      ? UNANSWERED
      : dual.holds
        ? `Yes, ${dual.country ? countryName(dual.country) : 'country not answered'}`
        : 'No';
  return `${holds} · pending application: ${yesNo(dual.pendingApplication)}`;
}

/** "{n} / 4,000 characters". */
export function freeTextCounter(length: number): string {
  return `${formatNumber(length)} / ${formatNumber(FREE_TEXT_LIMIT)} characters`;
}
