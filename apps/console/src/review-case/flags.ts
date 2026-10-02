import { formatDate, formatNumber, plural } from '@adili/ui';

import type { Flag, Severity } from '../server/review/types';
import {
  countryName,
  type DeclarationView,
  itemLabel,
  relationOf,
  statementFor,
} from './declaration';
import { CATEGORY_LABELS, SEVERITY_ORDER } from './labels';

/**
 * The case's flags as the Flags tab lists them (spec 07a FE-3, S11): open flags grouped by
 * severity, high first; reviewed flags after them with the reviewer's note; flags closed by a
 * registry re-check last. Each flag's evidence in words, and the items it concerns. Pure.
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
    reviewed: flags.filter((flag) => flag.reviewed !== null && !flag.closedReason),
    closed: flags.filter((flag) => Boolean(flag.closedReason)),
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
      relationOf(ref.personKey) === 'officer' ? declarant : null,
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
