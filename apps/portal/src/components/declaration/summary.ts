import { formatDate, formatMoney, plural } from '@adili/ui';

import {
  DETAIL_FIELD_LABELS,
  ITEM_FIELD_LABELS,
  PERSON_FIELD_LABELS,
} from '../../declaration/field-labels';
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
import { ageOn, fullName, UNANSWERED } from '../../declaration/format';
import { changeWord, OCCUPATION_SECTOR_LABELS } from '../../declaration/labels';
import type { Category } from '../../declaration/statement';
import { type SectionKind, sectionKind } from '../../declaration/section-key';
import { liveSections, stepTitle } from './steps';
import { problemMessage } from './submit';

/**
 * The summary's rules and words (FE-8): what the note beside Submit says (S20), the blocking
 * issues panel, and the paragraph cards read from the summary's assembled document. Works on
 * draft contents, so anything may be missing.
 */

export const SUBMIT_READY =
  'You will confirm your identity with a one-time code before submitting.';
export const NOT_ANSWERED = 'Not answered yet.';
export const BLOCKING_LIMIT = 12;

/**
 * What the note beside Submit says (spec 05 S20, spec 06 FE-2), from the service's
 * `cannotSubmitReason`: that a one-time code comes first when nothing stops it; otherwise how much
 * is left to complete, the statement date that has not come ("Available from 1 Nov 2027"), or
 * why the declaration or its obligation takes no submission, in the dialog's words.
 */
export function submitNote(
  summary: Pick<LoadedSummary, 'cannotSubmitReason'> & {
    blocking: readonly unknown[];
    declaration: { statementDate: string; dueDate: string };
  },
): string {
  const { declaration } = summary;
  switch (summary.cannotSubmitReason) {
    case null:
      return SUBMIT_READY;
    case 'incomplete':
      return `Complete the ${plural(summary.blocking.length, 'item')} listed above to submit.`;
    case 'before-statement-date':
      return `Available from ${formatDate(declaration.statementDate)}`;
    case 'not-a-draft':
      return 'This declaration has already been submitted.';
    case 'amendment-window-closed':
    case 'obligation-cancelled':
      return problemMessage(summary.cannotSubmitReason, declaration);
  }
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

/**
 * Field names as the section screens label them (`field-labels.ts`), for issues that name only
 * the problem. `value`, `type` and the share have long or per-person labels on their screens
 * ("Approximate value as at the statement date", "Mary's share"); the summary names them short.
 */
const FIELD_LABELS: Record<string, string> = {
  ...ITEM_FIELD_LABELS,
  ...DETAIL_FIELD_LABELS,
  ...PERSON_FIELD_LABELS,
  value: 'Value',
  amount: 'Amount',
  type: 'Type',
  sharePercent: 'Share',
};

/** Pointer parts that hold a field's value rather than name it (`/value/kesCents`). */
const VALUE_PARTS = new Set(['kesCents', 'currency']);

const ITEM_NOUNS: Record<Category, string> = {
  income: 'Income',
  assets: 'Asset',
  liabilities: 'Liability',
};

/**
 * Fields named by the end of their path, where the last part alone is ambiguous ("place" is the
 * place of birth); before the labels by last part.
 */
const PATH_LABELS: [suffix: string, label: string][] = [
  ['birth/date', 'Date of birth'],
  ['birth/place', 'Place of birth'],
  ['maritalStatusChange/explanation', 'Explanation of the change in marital status'],
  ['address/postal', 'Postal address'],
  ['address/physical', 'Physical address'],
  ['employment/nature', 'Nature of employment'],
  ['employment/natureOther', 'Nature of employment'],
  ['original/minorUnits', 'Original amount'],
  ['change/kind', 'What changed'],
  ['change/explanation', 'Explanation of the change'],
];

/** `acquisitionDate` → "Acquisition date": a field the list above does not name. */
function humanize(field: string): string {
  const words = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * An issue as the summary lists it. The rules write whole sentences; schema checks write what is
 * wrong with a field ("is required"), for the screen that shows it beside the field. Listed on
 * their own those read "is required / is required", so they are named: the item (its description,
 * or "Asset 2", a spouse or child by name) and the field, "One-bedroom apartment: Value is
 * required". The rules' sentences start with a capital and schema checks' fragments do not; the
 * issue's code cannot tell them apart, as both use `required`.
 */
export function issueText(issue: CompletenessIssue, document: SummaryDocument): string {
  const { message } = issue;
  if (!/^[a-z]/.test(message)) return message;
  const parts = issue.path.split('/').slice(1);
  const named = parts.filter((part) => !/^\d+$/.test(part) && !VALUE_PARTS.has(part));
  const last = named.at(-1);
  const tail = named.join('/');
  const compound = PATH_LABELS.find(([suffix]) => tail === suffix || tail.endsWith(`/${suffix}`));
  const field = compound
    ? compound[1]
    : last
      ? (FIELD_LABELS[last] ?? humanize(last))
      : 'This answer';
  const [category, index] = parts;
  const personKey = issue.sectionKey.startsWith('statement:')
    ? issue.sectionKey.slice('statement:'.length)
    : null;
  if (personKey && (category === 'income' || category === 'assets' || category === 'liabilities')) {
    const position = Number(index);
    if (Number.isInteger(position)) {
      const statement = document.statements?.find((each) => each.personKey === personKey);
      const description = statement?.[category]?.[position]?.description?.trim();
      const item =
        description !== undefined && description.length > 0
          ? description
          : `${ITEM_NOUNS[category]} ${String(position + 1)}`;
      return last === category ? `${item}: ${message}` : `${item}: ${field} ${message}`;
    }
  }
  // A spouse's or child's field names the person: the household lists several.
  if (issue.sectionKey === 'household' && (category === 'spouses' || category === 'children')) {
    const position = Number(parts[2]);
    if (index === 'items' && Number.isInteger(position)) {
      const name = fullName(document[category]?.items?.[position]?.name);
      const person = name || `${PERSON_NOUNS[category]} ${String(position + 1)}`;
      // An issue with the entry itself, not one of its fields, names the person only.
      return last === 'items' ? `${person}: ${message}` : `${person}: ${field} ${message}`;
    }
  }
  return `${field} ${message}`;
}

const PERSON_NOUNS = { spouses: 'Spouse', children: 'Child' } as const;

export type ParagraphCompleteness = 'not-started' | 'incomplete' | 'complete';

/** A card's badge: its sections' completeness; the statements card reads every statement. */
export function paragraphCompleteness(
  sections: DeclarationSection[],
  kind: SectionKind,
): ParagraphCompleteness {
  const live = liveSections(sections).filter((section) => sectionKind(section.key) === kind);
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
