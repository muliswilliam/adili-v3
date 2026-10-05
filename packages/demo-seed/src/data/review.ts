/**
 * The PSC review team and the cases the demo's review states (#618) are built on. PSC is the
 * Commission the demo's staff accounts work in; its synthetic volume gives the queue its depth.
 */

/** A PSC reviewer the realm file does not hold: the seed creates them as demo accounts. */
export interface ExtraReviewer {
  demoKey: string;
  firstName: string;
  lastName: string;
}

export const EXTRA_PSC_REVIEWERS: readonly ExtraReviewer[] = [
  { demoKey: 'psc-reviewer-2', firstName: 'Brian', lastName: 'Kiptoo' },
  { demoKey: 'psc-reviewer-3', firstName: 'Mercy', lastName: 'Wanjala' },
];

/** PSC's reviewers, the realm's first: worked cases are spread across them in this order. */
export const PSC_REVIEWERS: readonly string[] = [
  'reviewer',
  ...EXTRA_PSC_REVIEWERS.map((reviewer) => reviewer.demoKey),
];

/** PSC's supervisor (the realm's): approves what the reviewers propose. */
export const PSC_SUPERVISOR = 'supervisor';

/**
 * How many of the queue's current-cycle cases each band contributes to the worked set, claimed
 * across the reviewers. The rest of the queue stays unassigned, as a real one would.
 */
export const WORKED_PER_BAND = { high: 4, medium: 8, low: 10 } as const;

/**
 * The volume cases the timed states are built on, by their index among the medium-band
 * current-cycle cases of synthetic officers (sorted by personnel file number), so a fresh stack
 * picks the same people every run.
 */
export const TIMED_CASES = {
  /** A clarification answered and resolved, then a compliant determination approved. */
  resolved: 0,
  /** A clarification left unanswered past its window: the ladder at its notice and warning. */
  escalated: 1,
  /** The same, carried to a salary stoppage the payroll acknowledges. */
  stoppage: 2,
} as const;

/** What the seeded clarifications and determinations say: short, as a reviewer writes. */
export const TEXT = {
  resolvedItem:
    'Your declaration lists a salary from the Ministry but no allowances. Please explain whether you received any house or commuter allowance in the period, and their amounts.',
  resolvedResponse:
    'I received a commuter allowance of KES 8,000 a month, included in the gross salary figure I declared. I have no house allowance.',
  resolvedNote: 'Explained: the allowance is part of the declared gross salary.',
  resolvedReasons:
    'The declaration is complete. The clarification on allowances was answered and the answer is consistent with payroll.',
  unansweredItem:
    'The Lands registry shows a parcel registered in your name that your declaration does not list. Please declare it, or explain why it is not yours.',
  proposedReasons:
    'No indicators were raised. Income and assets are consistent with the previous declaration and the registries.',
  kipronoEdit:
    ' Please attach your current KRA tax compliance certificate, or proof of an application for one.',
} as const;

/**
 * The officer the demo refers to EACC after two missed cycles (spec 08 S12, Regs r.20(2)): EACC's
 * own staff member (EACC is the responsible Commission for its staff), who filed neither the
 * 2022 nor the 2024 declaration. His row is in the EACC roster fixture.
 */
export const REFERRAL_OFFICER = {
  commission: 'eacc',
  nationalId: '25813407',
  demoKey: 'referral-officer',
} as const;

/** The cycle before the demo's previous one: EACC's obligations start there, so two can be missed. */
export const EARLIER_CYCLE = 2022;

/** EACC's own staff supervisor (spec 08 approvals for EACC as a Commission), a seeded demo account. */
export const EACC_HR_SUPERVISOR = {
  demoKey: 'eacc-hr-supervisor',
  firstName: 'Lilian',
  lastName: 'Chepkoech',
} as const;
