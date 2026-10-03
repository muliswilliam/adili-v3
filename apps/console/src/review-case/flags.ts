import { countryName, formatDate, formatNumber, plural } from '@adili/ui';

import type { Flag, Severity } from '../server/review/types';
import { type DeclarationView, itemLabel, relationOf, statementFor } from './declaration';
import { CATEGORY_LABELS, SEVERITY_ORDER } from './labels';
import { roleWords } from './registry';

/**
 * The case's flags as the Flags tab lists them (spec 07a FE-3, S11): open flags grouped by
 * severity, high first; reviewed flags after them with the reviewer's note (a reviewed flag a
 * registry re-check then closed stays with them, keeping its note); flags a re-check closed
 * before anyone reviewed them last. Each flag's evidence in words, and the items it concerns. Pure.
 */

export interface FlagGroups<F extends Flag = Flag> {
  open: { severity: Severity; flags: F[] }[];
  reviewed: F[];
  closed: F[];
  openCount: number;
}

export function groupFlags<F extends Flag>(flags: F[]): FlagGroups<F> {
  const open = flags.filter((flag) => flag.reviewed === null && !flag.closedReason);
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

const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function categoryWord(value: unknown): string | null {
  const category = str(value);
  return category && category in CATEGORY_LABELS
    ? CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]
    : null;
}

/**
 * The flag's evidence in one line, from the clear facts the rules record (percentages, counts,
 * dates; never amounts): "Value up 41% from the previous version". Null when the evidence has
 * nothing to say (a first declaration, a rule this console has no words for).
 */
export function evidenceLine(flag: Pick<Flag, 'ruleId' | 'evidence'>): string | null {
  const e = flag.evidence;
  switch (flag.ruleId) {
    case 'value-change-25': {
      const percent = num(e.changePercent);
      const direction = str(e.direction) === 'down' ? 'down' : 'up';
      return percent === null
        ? 'Value up from nil in the previous version'
        : `Value ${direction} ${formatNumber(percent)}% from the previous version`;
    }
    case 'change-flag-mismatch': {
      const percent = num(e.changePercent);
      const moved =
        percent === null ? 'value up from nil' : `value moved ${formatNumber(percent)}%`;
      return `${e.markedAsChanged === true ? 'Marked as changed' : 'Not marked as changed'} · ${moved}`;
    }
    case 'acquisition-unflagged':
      return 'Not in the previous version · not marked as new';
    case 'disposal-unflagged':
      return 'In the previous version, not in this one · no disposal recorded';
    case 'nil-after-populated': {
      const category = categoryWord(e.category) ?? 'Category';
      const items = num(e.previousItems);
      return items === null
        ? `${category} nil`
        : `${category} nil · ${plural(items, 'item')} in the previous version`;
    }
    case 'income-vs-asset-growth': {
      const ratio = num(e.growthToIncome);
      return ratio === null
        ? 'Assets grew with no income declared for the period'
        : `Asset growth ${formatNumber(ratio)} times the income declared for the period`;
    }
    case 'late-filing': {
      const days = num(e.daysLate);
      const due = str(e.dueDate);
      if (days === null) return null;
      return `Submitted ${plural(days, 'day')} after the due date${due ? ` (${formatDate(due)})` : ''}`;
    }
    case 'foreign-holdings': {
      const items = num(e.items);
      const countries = Array.isArray(e.countries)
        ? e.countries.filter((each): each is string => typeof each === 'string').map(countryName)
        : [];
      if (items === null) return null;
      return `${plural(items, 'item')} outside Kenya${countries.length ? ` (${countries.join(', ')})` : ''}`;
    }
    case 'joint-share-inconsistent': {
      const total = num(e.sharePercentTotal);
      const statements = num(e.statements);
      if (total === null) return null;
      return `Shares add up to ${formatNumber(total)}%${statements === null ? '' : ` across ${plural(statements, 'statement')}`}`;
    }
    case 'completeness-residual': {
      const issues = num(e.issues);
      return issues === null ? null : `${plural(issues, 'form check')} not met`;
    }
    case 'no-previous-version':
      return 'No previous version';
    case 'registry-parcel-undeclared':
    case 'declared-parcel-not-found': {
      const parcel = str(e.parcelNumber);
      return parcel ? `Parcel ${parcel}` : null;
    }
    case 'registry-vehicle-undeclared':
    case 'declared-vehicle-not-found': {
      const vehicle = str(e.registrationNumber);
      return vehicle ? `Vehicle ${vehicle}` : null;
    }
    case 'registry-directorship-undeclared':
    case 'declared-company-not-found':
    case 'directorship-employer-supplier': {
      const company = str(e.companyRegistrationNumber);
      const role = str(e.role);
      const parts = [
        company ? `Company ${company}` : null,
        role ? `role ${roleWords(role).toLowerCase()}` : null,
        flag.ruleId === 'directorship-employer-supplier' ? "on the employer's supplier list" : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(' · ') : null;
    }
    case 'kra-pin-missing':
      return 'No KRA PIN found for this national ID';
    case 'kra-non-compliant': {
      const pins = num(e.pins);
      return pins === null ? 'Not tax compliant' : `${plural(pins, 'PIN')} · not tax compliant`;
    }
    case 'kra-income-mismatch': {
      const difference = num(e.differencePercent);
      if (difference === null) return null;
      return `Income declared to KRA ${e.direction === 'below' ? 'lower' : 'higher'} by ${formatNumber(difference)}%`;
    }
    case 'registry-supplier-check-not-run': {
      const companies = num(e.companies);
      return companies === null
        ? null
        : `${String(companies)} ${companies === 1 ? 'company' : 'companies'} listed at BRS`;
    }
    case 'registry-company-dissolved': {
      const company = str(e.companyRegistrationNumber);
      return company ? `Company ${company} dissolved` : null;
    }
    default:
      return null;
  }
}

/**
 * What the flag concerns, by its item refs: each item where it sits ("Assets · Land · Plot
 * 1234 · John Otieno"), or the person's statement ("Liabilities · John Otieno"). A flag with no
 * refs concerns the declaration as a whole.
 */
export function concernsLine(flag: Flag, view: DeclarationView | null, declarant: string): string {
  const category = categoryWord(flag.evidence.category);
  if (flag.itemRefs.length === 0) return `Declaration · ${declarant}`;
  const parts = flag.itemRefs.map((ref) => {
    const item = ref.itemId && view ? itemLabel(view, ref.itemId) : null;
    if (item) return item;
    const name = firstText(
      view ? statementFor(view, ref.personKey)?.name : null,
      relationOf(ref.personKey) === 'declarant' ? declarant : null,
    );
    return [category ?? 'Statement', name].filter(Boolean).join(' · ');
  });
  return [...new Set(parts)].join('; ');
}

/** The first of `values` with any text, or ''. */
function firstText(...values: (string | null | undefined)[]): string {
  return values.find((value) => value) ?? '';
}

/** The first item a flag points at, for "Go to item"; null for a flag about no single item. */
export function flagItemId(flag: Flag): string | null {
  return flag.itemRefs.find((ref) => ref.itemId)?.itemId ?? null;
}

/** The open flags on each item, by item id, for the pins in the declaration pane. */
export function openFlagsByItem<F extends Flag>(flags: F[]): Map<string, F[]> {
  const byItem = new Map<string, F[]>();
  for (const flag of flags) {
    if (flag.reviewed !== null || flag.closedReason) continue;
    for (const ref of flag.itemRefs) {
      if (!ref.itemId) continue;
      const list = byItem.get(ref.itemId) ?? [];
      if (!list.includes(flag)) list.push(flag);
      byItem.set(ref.itemId, list);
    }
  }
  return byItem;
}

/**
 * The open flags on a section as a whole (a reference with no item: a category declared nil, a
 * registry record no item declares), by section key (`bio`, `household`, `other`, or
 * `statement:<personKey>` for a person's statement), for the pins on the pane's headings.
 */
export function openFlagsBySection<F extends Flag>(flags: F[]): Map<string, F[]> {
  const bySection = new Map<string, F[]>();
  for (const flag of flags) {
    if (flag.reviewed !== null || flag.closedReason) continue;
    for (const ref of flag.itemRefs) {
      if (ref.itemId) continue;
      const key = ref.sectionKey ?? `statement:${ref.personKey}`;
      const list = bySection.get(key) ?? [];
      if (!list.includes(flag)) list.push(flag);
      bySection.set(key, list);
    }
  }
  return bySection;
}

/** The highest severity among flags. */
export function topSeverity(flags: Flag[]): Severity {
  return (
    SEVERITY_ORDER.find((severity) => flags.some((flag) => flag.severity === severity)) ?? 'info'
  );
}

/** The DOM id of a flag card, so a pin in the declaration pane can scroll to it. */
export const flagAnchorId = (flagId: string) => `flag-${flagId}`;

export const FLAG_NOTE_MAX_LENGTH = 1000;

/** What is wrong with a reviewed note, or null when it can be saved. */
export function flagNoteError(note: string): string | null {
  if (!note.trim()) return 'Add a note to record what you concluded.';
  if (note.length > FLAG_NOTE_MAX_LENGTH) return 'Notes can be up to 1,000 characters.';
  return null;
}
