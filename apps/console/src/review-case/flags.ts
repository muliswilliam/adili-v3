import type { DeclarationV1 } from '@adili/forms';
import { COUNTRIES, findItem, formatDate, personFullName, typeLabel } from '@adili/ui';

import type { CaseFlag as Flag } from '../server/review-case.server';
import type { Severity } from '../server/review/types';
import { roleWords } from './registry';

/**
 * The flags tab's arithmetic (spec 07a FE-3): open flags grouped by severity, reviewed and closed
 * ones after them; the evidence line each rule's facts read as; what a flag points at in the
 * declaration; and the pins the declaration pane shows on flagged items.
 */

/** Highest first, as the tab lists them. */
export const SEVERITY_ORDER: readonly Severity[] = ['high', 'medium', 'low', 'info'];

export interface FlagGroups {
  /** Open flags by severity, highest first; severities without flags left out. */
  open: { severity: Severity; flags: Flag[] }[];
  reviewed: Flag[];
  /** Closed by a registry re-check and not reviewed (a reviewed one stays with the reviewed). */
  closed: Flag[];
  openCount: number;
}

export function isOpen(flag: Flag): boolean {
  return flag.reviewed === null && !flag.closedReason;
}

export function groupFlags(flags: readonly Flag[]): FlagGroups {
  const open = flags.filter(isOpen);
  return {
    open: SEVERITY_ORDER.map((severity) => ({
      severity,
      flags: open.filter((flag) => flag.severity === severity),
    })).filter((group) => group.flags.length > 0),
    reviewed: flags.filter((flag) => flag.reviewed !== null),
    closed: flags.filter((flag) => flag.reviewed === null && Boolean(flag.closedReason)),
    openCount: open.length,
  };
}

const CATEGORY_WORDS: Record<string, string> = {
  income: 'Income',
  assets: 'Assets',
  liabilities: 'Liabilities',
};

function count(value: unknown, noun: string): string | null {
  if (typeof value !== 'number') return null;
  return `${String(value)} ${noun}${value === 1 ? '' : 's'}`;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function percent(value: unknown): string | null {
  return typeof value === 'number' ? `${String(value)}%` : null;
}

/** `template` around a value, or null when there is no value. */
function around(value: string | null, template: (value: string) => string): string | null {
  return value === null ? null : template(value);
}

function categoryOf(value: unknown): string | null {
  return typeof value === 'string' ? (CATEGORY_WORDS[value] ?? null) : null;
}

function join(parts: (string | null)[]): string | null {
  const present = parts.filter((part): part is string => part !== null);
  return present.length > 0 ? present.join(' · ') : null;
}

function countryNames(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const names = value.flatMap((code) =>
    typeof code === 'string' ? [COUNTRIES.find((each) => each.code === code)?.name ?? code] : [],
  );
  return names.length > 0 ? names.join(', ') : null;
}

/**
 * The facts behind a flag in a line, e.g. "Value up 41% from version 1" (review.yaml `evidence`:
 * percentages, counts, dates and codes, never amounts). Null when the rule records none.
 */
export function evidenceLine(
  flag: Pick<Flag, 'ruleId' | 'evidence'>,
  previousVersion: number | null,
): string | null {
  const e = flag.evidence;
  const from =
    previousVersion === null ? 'the previous version' : `version ${String(previousVersion)}`;
  const change = percent(e.changePercent);
  switch (flag.ruleId) {
    case 'value-change-25':
      return change === null
        ? `Value up from nil in ${from}`
        : `Value ${e.direction === 'down' ? 'down' : 'up'} ${change} from ${from}`;
    case 'change-flag-mismatch':
      return join([
        change === null ? 'Up from nil' : `Change of ${change}`,
        e.markedAsChanged === true ? 'marked as changed' : 'not marked as changed',
      ]);
    case 'acquisition-unflagged':
      return join([categoryOf(e.category), `not in ${from}`]);
    case 'disposal-unflagged':
      return join([categoryOf(e.category), `only in ${from}`]);
    case 'nil-after-populated':
      return join([
        around(categoryOf(e.category), (category) => `${category} nil`),
        around(count(e.previousItems, 'item'), (items) => `${items} in ${from}`),
      ]);
    case 'income-vs-asset-growth':
      return typeof e.growthToIncome === 'number'
        ? `Asset growth ${String(e.growthToIncome)} times the income declared`
        : 'Assets grew with no income declared';
    case 'late-filing':
      return around(
        count(e.daysLate, 'day'),
        (days) =>
          `Submitted ${days} after the due date` +
          (typeof e.dueDate === 'string' ? ` (${formatDate(e.dueDate)})` : ''),
      );
    case 'foreign-holdings':
      return join([count(e.items, 'item'), countryNames(e.countries)]);
    case 'joint-share-inconsistent':
      return join([
        around(percent(e.sharePercentTotal), (total) => `Shares add up to ${total}`),
        count(e.statements, 'statement'),
      ]);
    case 'completeness-residual':
      return around(count(e.issues, 'form check'), (issues) => `${issues} not met`);
    case 'registry-parcel-undeclared':
    case 'declared-parcel-not-found':
      return around(text(e.parcelNumber), (parcel) => `Parcel ${parcel}`);
    case 'registry-vehicle-undeclared':
    case 'declared-vehicle-not-found':
      return around(text(e.registrationNumber), (vehicle) => `Vehicle ${vehicle}`);
    case 'registry-directorship-undeclared':
    case 'declared-company-not-found':
    case 'directorship-employer-supplier':
      return join([
        around(text(e.companyRegistrationNumber), (company) => `Company ${company}`),
        around(text(e.role), (role) => `role ${roleWords(role).toLowerCase()}`),
        flag.ruleId === 'directorship-employer-supplier' ? "on the employer's supplier list" : null,
      ]);
    case 'kra-pin-missing':
      return 'No KRA PIN found for this national ID';
    case 'kra-non-compliant':
      return join([count(e.pins, 'PIN'), 'not tax compliant']);
    case 'kra-income-mismatch':
      return around(
        percent(e.differencePercent),
        (difference) =>
          `Income declared to KRA ${e.direction === 'below' ? 'lower' : 'higher'} by ${difference}`,
      );
    case 'registry-company-dissolved':
      return around(text(e.companyRegistrationNumber), (company) => `Company ${company} dissolved`);
    // The item it points at is the fact: it carries no identifier to compare.
    case 'registry-parcel-number-missing':
    case 'registry-vehicle-registration-missing':
    case 'registry-company-registration-missing':
    case 'no-previous-version':
      return null;
  }
}

/** The declaration's words for a person key: their full name. */
function personName(document: DeclarationV1 | null, personKey: string): string | null {
  const statement = document?.statements.find((each) => each.personKey === personKey);
  return statement ? personFullName(statement.personName) : null;
}

const SECTION_WORDS: Record<string, string> = {
  bio: 'Personal and employment details',
  household: 'Spouses and children',
  other: 'Other information',
};

/**
 * What a flag points at, e.g. "Assets · Building · Wanjiku Njeri Kamau"; one line per reference,
 * joined. Empty when the flag concerns the declaration as a whole.
 */
export function flagTargetLine(
  flag: Pick<Flag, 'itemRefs'>,
  document: DeclarationV1 | null,
): string {
  // Without the declaration nothing can be named.
  if (!document) return '';
  return flag.itemRefs
    .map((ref) => {
      const name = personName(document, ref.personKey);
      if (ref.itemId) {
        const found = findItem(document, ref.itemId);
        if (found) {
          return [CATEGORY_WORDS[found.category], typeLabel(found.category, found.item), name]
            .filter(Boolean)
            .join(' · ');
        }
      }
      const section = ref.sectionKey ? SECTION_WORDS[ref.sectionKey] : undefined;
      return [section ?? 'Financial statement', name].filter(Boolean).join(' · ');
    })
    .filter(Boolean)
    .join('; ');
}

/** Where "Go to item" sends the reviewer: the first item a flag names, else its first section. */
export function flagTarget(
  flag: Pick<Flag, 'itemRefs'>,
  document: DeclarationV1 | null,
): {
  highlight: string;
  itemId: string | null;
  personKey: string;
  sectionKey: string | null;
} | null {
  if (!document) return null;
  const withItem = flag.itemRefs.find((ref) => ref.itemId && findItem(document, ref.itemId));
  if (withItem?.itemId) {
    return {
      highlight: withItem.itemId,
      itemId: withItem.itemId,
      personKey: withItem.personKey,
      sectionKey: null,
    };
  }
  const first = flag.itemRefs[0];
  if (!first) return null;
  const sectionKey = first.sectionKey ?? `statement:${first.personKey}`;
  return { highlight: sectionKey, itemId: null, personKey: first.personKey, sectionKey };
}

export interface ItemPin {
  count: number;
  /** The highest severity among the open flags on the item. */
  severity: Severity;
  /** The flag the pin opens: the first of the highest severity. */
  flagId: string;
}

/** Open flags on each item, for the pins in the declaration pane. */
export function pinsByItem(flags: readonly Flag[]): Map<string, ItemPin> {
  const pins = new Map<string, ItemPin>();
  const ordered = [...flags.filter(isOpen)].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
  for (const flag of ordered) {
    const items = new Set(flag.itemRefs.flatMap((ref) => (ref.itemId ? [ref.itemId] : [])));
    for (const itemId of items) {
      const pin = pins.get(itemId);
      if (pin) pin.count += 1;
      else pins.set(itemId, { count: 1, severity: flag.severity, flagId: flag.id });
    }
  }
  return pins;
}
