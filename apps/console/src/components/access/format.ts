import { formatDate, formatScope, type Scope } from '@adili/ui';

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

/** `2025, 2026 · Officer and spouses · Income, liabilities`, in the officer's words. */
export function scopeText(scope: Scope): string {
  return formatScope(scope, scopePeople);
}
