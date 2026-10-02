import type { Scope } from '@adili/ui';
import { SCOPE_SECTIONS, scopeSectionLabels } from '@adili/ui';

import { FORM_K_COPY as COPY } from './copy';

/** A scope as the chips the review and a request's page show: years, people, sections. */
export function scopeChips(scope: Scope): {
  years: string[];
  people: string[];
  sections: string[];
  clarifications: boolean;
} {
  return {
    years: [...scope.years].sort((a, b) => a - b).map(String),
    people: [
      COPY.theDeclarant,
      ...(scope.includeSpouses ? [COPY.spouses] : []),
      ...(scope.includeChildren ? [COPY.children] : []),
    ],
    sections: SCOPE_SECTIONS.filter((section) => scope.sections.includes(section)).map(
      (section) => scopeSectionLabels[section],
    ),
    clarifications: scope.includeClarifications,
  };
}
