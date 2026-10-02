import type { Scope } from '@adili/ui';
import { SCOPE_SECTIONS, scopeSectionLabels } from '@adili/ui';

import { FORM_K_COPY as COPY } from './copy';

/** A Kenyan E.164 number grouped for reading, `+254 722 418 903`; others as stored. */
export function displayPhone(e164: string): string {
  const kenyan = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return kenyan ? `+254 ${kenyan[1]} ${kenyan[2]} ${kenyan[3]}` : e164;
}

/** A scope as the chips the review and a request's page show: years, people, sections. */
export function scopeChips(scope: Scope): {
  years: string[];
  people: string[];
  sections: string[];
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
  };
}
