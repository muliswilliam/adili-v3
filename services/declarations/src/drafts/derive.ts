import type { Child, DECLARATION_TYPES, DeclarationV1 } from '@adili/forms';

/**
 * Pure derivations of a declaration's fixed values (spec 05, BE-3): nothing is chosen by hand.
 * Dates are calendar dates as `YYYY-MM-DD`, which compare correctly as strings.
 */

/** declarations.yaml `ObligationType`: initial, biennial or final. */
export type ObligationType = (typeof DECLARATION_TYPES)[number];

/** What the obligation fixes: the declaration's type and statement date. */
export interface ObligationFacts {
  type: ObligationType;
  statementDate: string;
}

/** What Adili knows of the person's past, for the start of the income period. */
export interface PersonHistory {
  /** Statement date of the person's most recent submitted declaration on Adili. */
  previousStatementDate?: string;
  /** Appointment date on the roster record the obligation is for. */
  appointmentDate?: string;
}

export interface IncomePeriod {
  /** Exclusive: the income period is (from, to]. */
  from: string;
  to: string;
  /**
   * `declared`: from is the statement date of a declaration on Adili. `assumed`: there is none,
   * so from is derived from the type, and reviewers can see the period was not declared.
   */
  fromSource: 'declared' | 'assumed';
}

export interface DerivedHeader extends ObligationFacts {
  incomePeriod: IncomePeriod;
}

/**
 * The header a draft starts with. An initial covers the year ending on its statement date, which
 * for an initial obligation is the appointment date; its `fromSource` is `assumed` because the
 * start is derived from the type, not taken from a declaration on Adili. A
 * biennial or final runs from the previous statement date on Adili; without one it assumes two
 * years, or less when the person was appointed within them (the first cycle after appointment).
 */
export function deriveHeader(
  { type, statementDate }: ObligationFacts,
  { previousStatementDate, appointmentDate }: PersonHistory,
): DerivedHeader {
  const header = (from: string, fromSource: IncomePeriod['fromSource']): DerivedHeader => ({
    type,
    statementDate,
    incomePeriod: { from, to: statementDate, fromSource },
  });
  if (type === 'initial') return header(addYears(statementDate, -1, 'feb-28'), 'assumed');
  if (previousStatementDate) return header(previousStatementDate, 'declared');
  const twoYearsBefore = addYears(statementDate, -2, 'feb-28');
  return header(
    appointmentDate && appointmentDate > twoYearsBefore ? appointmentDate : twoYearsBefore,
    'assumed',
  );
}

export type ChildInclusion =
  { included: true } | { included: false; reason: 'over-18-at-statement-date' };

/**
 * Whether a dependent child is under eighteen on the statement date (Act s.31(1)), so that they
 * get a financial statement. A child born on 29 February turns eighteen on 1 March in a
 * common year: until then they are still included, the side that discloses more.
 */
export function childInclusion(dateOfBirth: string, statementDate: string): ChildInclusion {
  return addYears(dateOfBirth, 18, 'mar-1') > statementDate
    ? { included: true }
    : { included: false, reason: 'over-18-at-statement-date' };
}

export interface ChildExclusion {
  childId: string;
  reason: 'over-18-at-statement-date';
}

/**
 * The household's children with `includedAtStatementDate` derived from their dates of birth, and
 * the children left out with the reason to show. What the client sent for inclusion is ignored:
 * clear metadata is derived on save, never trusted.
 */
export function applyChildInclusion(
  children: DeclarationV1['children'],
  statementDate: string,
): { children: DeclarationV1['children']; excluded: ChildExclusion[] } {
  const excluded: ChildExclusion[] = [];
  const items = children.items.map((child): Child => {
    const inclusion = childInclusion(child.dateOfBirth, statementDate);
    if (!inclusion.included) excluded.push({ childId: child.id, reason: inclusion.reason });
    return { ...child, includedAtStatementDate: inclusion.included };
  });
  return { children: { ...children, items }, excluded };
}

/** `date` moved by whole years; 29 February lands on 28 February or 1 March in a common year. */
function addYears(date: string, years: number, leapDay: 'feb-28' | 'mar-1'): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const target = year + years;
  if (month === 2 && day === 29 && !isLeapYear(target)) {
    return leapDay === 'feb-28' ? isoDate(target, 2, 28) : isoDate(target, 3, 1);
  }
  return isoDate(target, month, day);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
