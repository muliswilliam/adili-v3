import type { Scope } from '@adili/ui';

import { scopePeople, scopeSections, scopeYears } from '../format';

/** `2025, 2026 · Officer and spouses · Income, liabilities · clarifications`, in the officer's words. */
export function scopeText(scope: Scope): string {
  return [
    scopeYears(scope),
    scopePeople(scope),
    scopeSections(scope),
    ...(scope.includeClarifications ? ['clarifications'] : []),
  ].join(' · ');
}
