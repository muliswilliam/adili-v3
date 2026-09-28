import { formatDate, formatMoney } from '@adili/ui';

import type { JsonObject, LoadedSummary } from '../../server/declarations.server';
import type {
  CompletenessIssue,
  DeclarationSection,
  SectionKey,
} from '../../server/declarations/types';
import type {
  AssetItem,
  Child,
  Draft,
  Household,
  IncomeItem,
  LiabilityItem,
  MaritalStatus,
  Officer,
  OtherInformation,
  Spouse,
  Statement,
} from '../../declaration/contents';
import { ageOn, UNANSWERED } from '../../declaration/format';
import { changeWord, OCCUPATION_SECTOR_LABELS } from '../../declaration/labels';
import type { Category } from '../../declaration/statement';
import { liveSections, sectionKind, stepTitle } from './steps';

/**
 * The summary's rules and words (FE-8): what the disabled Submit says (S20), the blocking
 * issues panel, and the paragraph cards read from the summary's assembled document. Works on
 * draft contents, so anything may be missing.
 */

export const SUBMIT_NEXT_RELEASE = 'Submission opens in the next release.';
export const NOT_ANSWERED = 'Not answered yet.';
export const BLOCKING_LIMIT = 12;

/**
 * S20: submission is never open in spec 05. Before the statement date the declarant is told
 * when it will be ("Available from 1 Nov 2027"); otherwise that it opens in the next release.
 * The service gives one reason, and `incomplete` hides `before-statement-date`, so only then is
 * the date checked here; any other reason from the service stands.
 */
export function submitNote(
  summary: Pick<LoadedSummary, 'cannotSubmitReason'> & {
    declaration: { statementDate: string };
  },
  today: string,
): string {
  const { statementDate } = summary.declaration;
  const { cannotSubmitReason } = summary;
  const upcoming =
    cannotSubmitReason === 'before-statement-date' ||
    (cannotSubmitReason === 'incomplete' && today < statementDate);
  if (upcoming) {
    return `Available from ${formatDate(statementDate)}`;
  }
  return SUBMIT_NEXT_RELEASE;
}

/** Today in Kenya, as an ISO date. */
export function todayInKenya(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(now);
}

export function blockingTitle(count: number): string {
  return `${String(count)} ${count === 1 ? 'thing' : 'things'} to complete before you can submit`;
}

export interface BlockingGroup {
  key: SectionKey;
  label: string;
  issues: CompletenessIssue[];
}

/** Issues grouped by section in the order they came, the first twelve, and how many more. */
export function blockingGroups(
  blocking: CompletenessIssue[],
  sections: DeclarationSection[],
  limit = BLOCKING_LIMIT,
): { groups: BlockingGroup[]; hidden: number } {
  const groups: BlockingGroup[] = [];
  for (const issue of blocking.slice(0, limit)) {
    let group = groups.find((candidate) => candidate.key === issue.sectionKey);
    if (!group) {
      group = { key: issue.sectionKey, label: stepTitle(sections, issue.sectionKey), issues: [] };
      groups.push(group);
    }
    group.issues.push(issue);
  }
  return { groups, hidden: Math.max(0, blocking.length - limit) };
}

export type Paragraph = 'bio' | 'household' | 'statements' | 'other';
export type ParagraphCompleteness = 'not-started' | 'incomplete' | 'complete';

/** A card's badge: its section's completeness; the statements card reads all of them. */
export function paragraphCompleteness(
  sections: DeclarationSection[],
  paragraph: Paragraph,
): ParagraphCompleteness {
  const live = liveSections(sections).filter((section) =>
    paragraph === 'statements'
      ? sectionKind(section.key) === 'statement'
      : section.key === paragraph,
  );
  if (live.length === 0) return 'not-started';
  if (live.every((section) => section.completeness === 'complete')) return 'complete';
  if (live.every((section) => section.completeness === 'not-started')) return 'not-started';
  return 'incomplete';
}

/** The summary's `document` (declaration.v1), as far as the draft has got. */
export interface SummaryDocument {
  officer?: Draft<Officer>;
  spouses?: Draft<Household['spouses']>;
  children?: Draft<Household['children']>;
  statements?: Draft<Statement>[];
  otherInformation?: Draft<OtherInformation>;
}

export function readSummaryDocument(document: JsonObject): SummaryDocument {
  return document;
}

/** "ID {nid} · KRA PIN {pin} · {Sector} sector · Separated since {date}". */
export function spouseDetails(spouse: Draft<Spouse>): string {
  const parts = [spouse.nationalId?.trim() ? `ID ${spouse.nationalId.trim()}` : 'ID not given'];
  if (spouse.kraPin?.trim()) parts.push(`KRA PIN ${spouse.kraPin.trim()}`);
  if (spouse.occupationSector) {
    parts.push(`${OCCUPATION_SECTOR_LABELS[spouse.occupationSector]} sector`);
  }
  if (spouse.separated) {
    parts.push(
      spouse.separationDate ? `Separated since ${formatDate(spouse.separationDate)}` : 'Separated',
    );
  }
  return parts.join(' · ');
}

/** "Born {dob} · Included: under 18 on {date}" or "... · Not included: {age} on the statement date". */
export function childDetails(child: Draft<Child>, statementDate: string): string {
  const born = child.dateOfBirth
    ? `Born ${formatDate(child.dateOfBirth)}`
    : 'Date of birth not given';
  if (child.includedAtStatementDate) {
    return `${born} · Included: under 18 on ${formatDate(statementDate)}`;
  }
  if (child.dateOfBirth && child.includedAtStatementDate === false) {
    return `${born} · Not included: ${String(ageOn(child.dateOfBirth, statementDate))} on the statement date`;
  }
  return born;
}

const UNMARRIED: MaritalStatus[] = ['single', 'divorced', 'widowed'];

/** Paragraph 6 with no spouses listed. */
export function spousesEmptyText(
  spouses: Draft<Household['spouses']> | undefined,
  maritalStatus: MaritalStatus | undefined,
): string {
  if (spouses?.none === true) return 'Declared: no spouse to declare.';
  if (maritalStatus && UNMARRIED.includes(maritalStatus)) return 'No spouse to declare.';
  return NOT_ANSWERED;
}

/** Paragraph 7 with no children listed. */
export function childrenEmptyText(children: Draft<Household['children']> | undefined): string {
  return children?.none === true ? 'Declared: no dependent children under 18.' : NOT_ANSWERED;
}

export interface Totals {
  income: number;
  assets: number;
  liabilities: number;
}

const sum = (amounts: (number | undefined)[]) =>
  amounts.reduce<number>((total, amount) => total + (amount ?? 0), 0);

/** Each category's total in KES cents (joint assets at their whole value). */
export function statementTotals(statement: Draft<Statement>): Totals {
  return {
    income: sum((statement.income ?? []).map((item) => item.amount?.kesCents)),
    assets: sum((statement.assets ?? []).map((item) => item.value?.kesCents)),
    liabilities: sum((statement.liabilities ?? []).map((item) => item.outstanding?.kesCents)),
  };
}

export type AnyItem = Draft<IncomeItem> | Draft<AssetItem> | Draft<LiabilityItem>;

function amountOf(item: AnyItem) {
  if ('amount' in item) return item.amount;
  if ('value' in item) return item.value;
  if ('outstanding' in item) return item.outstanding;
  return undefined;
}

/** "Joint, share {n}%", "Original {CUR} {amount}", "Changed: {kind}". */
export function itemFlags(category: Category, item: AnyItem): string[] {
  const flags: string[] = [];
  if ('joint' in item && item.joint?.isJoint) {
    flags.push(
      item.joint.sharePercent === undefined
        ? 'Joint'
        : `Joint, share ${String(item.joint.sharePercent)}%`,
    );
  }
  const original = amountOf(item)?.original;
  if (original?.currency && original.minorUnits !== undefined) {
    flags.push(`Original ${original.currency} ${formatMoney(original.minorUnits)}`);
  }
  if (item.change?.changed) {
    flags.push(item.change.kind ? `Changed: ${changeWord(category, item.change.kind)}` : 'Changed');
  }
  return flags;
}

/** An item's amount without the currency, or "Not answered". */
export function itemAmount(item: AnyItem): string {
  const cents = amountOf(item)?.kesCents;
  return cents === undefined ? UNANSWERED : formatMoney(cents);
}
