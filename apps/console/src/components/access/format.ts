import { formatDate, type Scope, scopeSectionLabels, SCOPE_SECTIONS } from '@adili/ui';

import { messages as m } from './messages';

/** `19 Sep` within the current Kenyan year, `19 Sep 2025` otherwise (the prototype's `fmtShort`). */
export function shortDate(iso: string, now: number = Date.now()): string {
  const date = formatDate(iso);
  const year = formatDate(new Date(now).toISOString()).slice(-4);
  return date.endsWith(` ${year}`) ? date.slice(0, -5) : date;
}

/**
 * Who a scope covers, in the officer's words: Form K names a public officer, the household
 * follows (the ScopePicker's "Declarant" is the portal's word for the same person).
 */
export function scopePeople(scope: Scope): string {
  if (scope.includeSpouses && scope.includeChildren) return m.officerSpousesChildren;
  if (scope.includeSpouses) return m.officerAndSpouses;
  if (scope.includeChildren) return m.officerAndChildren;
  return m.officerOnly;
}

/** `Income, assets`: the sections in the form's order, the first capitalised. */
export function scopeSections(scope: Scope): string {
  return SCOPE_SECTIONS.filter((section) => scope.sections.includes(section))
    .map((section, index) =>
      index === 0 ? scopeSectionLabels[section] : scopeSectionLabels[section].toLowerCase(),
    )
    .join(', ');
}

/** `2025, 2026`, in order. */
export function scopeYears(scope: Scope): string {
  return [...scope.years].sort((a, b) => a - b).join(', ');
}
