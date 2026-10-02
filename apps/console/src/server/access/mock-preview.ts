/**
 * What the access mocks' declarants hold, for the scope preview (spec 10, decision 1): every
 * onboarded officer of the mock roster has a declaration in 2025 and in 2026, but Grace Nyambura
 * Kamau, who filed none in 2026; officers with no account (served in writing) hold none. Counts
 * are fixed per section; Grace Atieno's 2025 declaration has a clarification.
 */
import { MOCK_ROSTER, MOCK_ROSTER_IDS } from './mock-roster';
import type { Scope, ScopePreview } from './types';

const SECTION_COUNTS = { income: 3, assets: 4, liabilities: 2, other: 2 } as const;
const SPOUSES = 1;
const CHILDREN = 2;

function declaresIn(recordId: string, year: number): boolean {
  if (recordId === MOCK_ROSTER_IDS.grace) return year === 2025;
  return year === 2025 || year === 2026;
}

/** The preview of `scope` for the declarant of roster record `recordId`. */
export function mockScopePreview(recordId: string, scope: Scope): ScopePreview {
  const onboarded = MOCK_ROSTER.find((each) => each.id === recordId)?.onboarded ?? false;
  const years = [...new Set(scope.years)]
    .sort((a, b) => a - b)
    .map((year) => {
      const held = onboarded && declaresIn(recordId, year) ? 1 : 0;
      const sections = Object.fromEntries(
        scope.sections.map((section) => [
          section,
          held *
            (section === 'bio'
              ? 1 + (scope.includeSpouses ? SPOUSES : 0) + (scope.includeChildren ? CHILDREN : 0)
              : SECTION_COUNTS[section]),
        ]),
      );
      const clarified = recordId === MOCK_ROSTER_IDS.graceAtieno && year === 2025 ? held : 0;
      return {
        year,
        declarations: held,
        sections,
        spouses: scope.includeSpouses ? held * SPOUSES : null,
        children: scope.includeChildren ? held * CHILDREN : null,
        clarifications: scope.includeClarifications ? clarified : null,
      };
    });
  const declarations = years.reduce((sum, year) => sum + year.declarations, 0);
  return {
    scope,
    declarantOnboarded: onboarded,
    empty: declarations === 0,
    declarations,
    clarifications: scope.includeClarifications
      ? years.reduce((sum, year) => sum + (year.clarifications ?? 0), 0)
      : null,
    years,
  };
}
