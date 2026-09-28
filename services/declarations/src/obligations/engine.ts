/**
 * The obligation engine (spec 04): which filing obligations a roster record owes, and the plan
 * that reconciles them with the ones that already exist. Pure, no I/O: the consumers and the
 * cycle opening apply the plan (rows, events, workflows), so these rules are tested on their own.
 *
 * - **Initial** (Act s.34(1)): statement date = appointment date, due `initialDueAfterAppointmentDays`
 *   later. Due from creation, overdue after the due date; never upcoming.
 * - **Biennial** (Act s.34(2)): one per opened cycle whose statement date the officer held office
 *   on (appointed on or before it, not exited before it). Upcoming before the statement date.
 * - **Final** (Act s.34(3)): statement date = exit date, due `finalDueAfterExitDays` later. Due from
 *   creation, like the initial.
 *
 * The Commission's obligations-start date gates creation: an obligation whose statement date is
 * before it is assumed declared outside Adili and is not created. Existing obligations are kept
 * when a later policy version moves the date.
 *
 * Reconciliation creates what is missing, supersedes an initial or final whose date changed
 * (the date is part of its cycle key), cancels what the record no longer owes, and links the
 * person once onboarded. `filed` obligations are never touched, and a filed initial or final
 * discharges that duty for the record: no replacement is created. `cancelled` rows are history
 * and play no part; a recreated obligation is a new row with the same cycle key.
 */
import { addDays, atMonthDay, type CivilDate } from './dates.js';

export const OBLIGATION_TYPES = ['initial', 'biennial', 'final'] as const;
export type ObligationType = (typeof OBLIGATION_TYPES)[number];

export const OBLIGATION_STATUSES = ['upcoming', 'due', 'overdue', 'filed', 'cancelled'] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

/** The status an obligation can be created in; `filed` and `cancelled` are terminal. */
export type OpenStatus = Extract<ObligationStatus, 'upcoming' | 'due' | 'overdue'>;

export const CANCEL_REASONS = [
  'exited-before-statement-date',
  'exit-reversed',
  'superseded',
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/** The declarations service's snapshot of a roster record, as the engine needs it. */
export interface RosterSnapshot {
  rosterRecordId: string;
  /** Null when the Commission's roster gives none: treated as appointed before any cycle. */
  appointmentDate: CivilDate | null;
  /** Set once an exit is confirmed; null again when a later import reverses it. */
  exitDate: CivilDate | null;
  /** Null until the declarant onboards. */
  personId: string | null;
  ofr: string | null;
}

/** The fields of the tenant policy version (directory `TenantPolicyVersion`) the rules read. */
export interface ObligationPolicy {
  version: number;
  obligationsStartDate: CivilDate;
  initialDueAfterAppointmentDays: number;
  /** Month-days, e.g. `11-01` and `12-31`. */
  biennial: { statementDate: string; dueDate: string };
  finalDueAfterExitDays: number;
  reminderOffsetsDays: readonly number[];
}

/** A biennial cycle: platform data (`cycle_calendar`), not tenant policy. */
export interface CycleCalendarEntry {
  cycleYear: number;
  /** Obligations for the cycle are created this many days before its statement date. */
  openingLeadDays: number;
}
export type CycleCalendar = readonly CycleCalendarEntry[];

/** The seeded calendar: cycles every two years from 2027, each opening 120 days ahead. */
export const DEFAULT_CYCLE_CALENDAR: CycleCalendar = [
  { cycleYear: 2027, openingLeadDays: 120 },
  { cycleYear: 2029, openingLeadDays: 120 },
  { cycleYear: 2031, openingLeadDays: 120 },
];

/** An obligation as stored, with what reconciliation reads. */
export interface ExistingObligation {
  id: string;
  type: ObligationType;
  cycleKey: string;
  status: ObligationStatus;
  personId: string | null;
}

/** A reminder: sent `offsetDays` before the due date (the workflow adds jitter). */
export interface PlannedReminder {
  offsetDays: number;
  date: CivilDate;
}

/** An obligation the record owes, with its status and reminders as of today. */
export interface DesiredObligation {
  type: ObligationType;
  /** `initial:<appointment date>`, `biennial:<year>` or `final:<exit date>`. */
  cycleKey: string;
  statementDate: CivilDate;
  dueDate: CivilDate;
  status: OpenStatus;
  policyVersion: number;
  personId: string | null;
  ofr: string | null;
  /** Reminders still ahead (today included), earliest first. */
  reminders: PlannedReminder[];
  /** Reminders already past when created: recorded `skipped-past-due-at-creation`, not sent. */
  skippedReminders: PlannedReminder[];
}

export type PlanOperation =
  | { kind: 'create'; obligation: DesiredObligation }
  | { kind: 'cancel'; obligationId: string; reason: CancelReason }
  /** Cancel the old obligation as `superseded` and create its replacement. */
  | { kind: 'supersede'; obligationId: string; obligation: DesiredObligation }
  | { kind: 'link-person'; obligationIds: string[]; personId: string; ofr: string | null };

export interface ObligationPlan {
  /**
   * Every obligation the record should have (existing, filed included, or to be created):
   * initial, biennials, final. Status and reminders are computed as of today; for existing
   * rows the stored status (written by the workflow) is authoritative.
   */
  obligations: DesiredObligation[];
  /** Cancels and supersedes first, then creates, then the person link. */
  operations: PlanOperation[];
}

export interface PlanInput {
  record: RosterSnapshot;
  policy: ObligationPolicy;
  calendar: CycleCalendar;
  /** Today in Africa/Nairobi (`nairobiDate`). */
  today: CivilDate;
  /** The record's obligations in any status. */
  existing: readonly ExistingObligation[];
}

/** The date a cycle's obligations are created (the cycle-opening schedule fires then). */
export function cycleOpeningDate(entry: CycleCalendarEntry, policy: ObligationPolicy): CivilDate {
  return addDays(biennialStatementDate(entry.cycleYear, policy), -entry.openingLeadDays);
}

/** The cycle years opened by `today`, oldest first. */
export function openedCycles(
  calendar: CycleCalendar,
  policy: ObligationPolicy,
  today: CivilDate,
): number[] {
  return calendar
    .filter((entry) => cycleOpeningDate(entry, policy) <= today)
    .map((entry) => entry.cycleYear)
    .sort((a, b) => a - b);
}

export function planObligations(input: PlanInput): ObligationPlan {
  const { record, existing } = input;
  const live = existing.filter((o) => o.status !== 'cancelled');
  const open = live.filter((o) => o.status !== 'filed');
  const liveKeys = new Set(live.map((o) => o.cycleKey));
  const filedTypes = new Set(live.filter((o) => o.status === 'filed').map((o) => o.type));

  const obligations = owedObligations(input).filter(
    (o) =>
      liveKeys.has(o.cycleKey) ||
      // Creation rules: the start date gates new obligations, and a filed initial or final
      // discharges that duty for the record whatever its dates say now.
      (o.statementDate >= input.policy.obligationsStartDate &&
        (o.type === 'biennial' || !filedTypes.has(o.type))),
  );
  const owedKeys = new Set(obligations.map((o) => o.cycleKey));

  const cancels: PlanOperation[] = [];
  const supersedes: PlanOperation[] = [];
  const replaced = new Set<string>();
  for (const old of open) {
    if (owedKeys.has(old.cycleKey)) continue;
    const replacement =
      old.type === 'biennial'
        ? undefined
        : obligations.find((o) => o.type === old.type && !liveKeys.has(o.cycleKey));
    if (replacement && !replaced.has(replacement.cycleKey)) {
      replaced.add(replacement.cycleKey);
      supersedes.push({ kind: 'supersede', obligationId: old.id, obligation: replacement });
    } else {
      cancels.push({
        kind: 'cancel',
        obligationId: old.id,
        reason: cancelReason(old, record, input.policy),
      });
    }
  }

  const creates: PlanOperation[] = obligations
    .filter((o) => !liveKeys.has(o.cycleKey) && !replaced.has(o.cycleKey))
    .map((obligation) => ({ kind: 'create', obligation }));

  const link: PlanOperation[] = [];
  if (record.personId !== null) {
    const unlinked = open
      .filter((o) => owedKeys.has(o.cycleKey) && o.personId !== record.personId)
      .map((o) => o.id);
    if (unlinked.length > 0) {
      link.push({
        kind: 'link-person',
        obligationIds: unlinked,
        personId: record.personId,
        ofr: record.ofr,
      });
    }
  }

  return { obligations, operations: [...cancels, ...supersedes, ...creates, ...link] };
}

/** What the record owes by the statutory rules alone, before the creation rules. */
function owedObligations(input: PlanInput): DesiredObligation[] {
  const { record, policy, calendar, today } = input;
  const { appointmentDate, exitDate } = record;
  const owed: DesiredObligation[] = [];

  if (appointmentDate !== null) {
    owed.push(
      obligation(input, 'initial', `initial:${appointmentDate}`, appointmentDate, {
        dueAfterDays: policy.initialDueAfterAppointmentDays,
      }),
    );
  }

  for (const year of openedCycles(calendar, policy, today)) {
    const statementDate = biennialStatementDate(year, policy);
    const heldOffice =
      (appointmentDate === null || appointmentDate <= statementDate) &&
      (exitDate === null || exitDate >= statementDate);
    if (!heldOffice) continue;
    owed.push(
      obligation(input, 'biennial', `biennial:${String(year)}`, statementDate, {
        dueDate: atMonthDay(year, policy.biennial.dueDate),
      }),
    );
  }

  if (exitDate !== null) {
    owed.push(
      obligation(input, 'final', `final:${exitDate}`, exitDate, {
        dueAfterDays: policy.finalDueAfterExitDays,
      }),
    );
  }

  return owed;
}

function obligation(
  { record, policy, today }: Pick<PlanInput, 'record' | 'policy' | 'today'>,
  type: ObligationType,
  cycleKey: string,
  statementDate: CivilDate,
  due: { dueAfterDays: number } | { dueDate: CivilDate },
): DesiredObligation {
  const dueDate = 'dueDate' in due ? due.dueDate : addDays(statementDate, due.dueAfterDays);
  const reminders = [...new Set(policy.reminderOffsetsDays)]
    .sort((a, b) => b - a)
    .map((offsetDays) => ({ offsetDays, date: addDays(dueDate, -offsetDays) }));
  return {
    type,
    cycleKey,
    statementDate,
    dueDate,
    status: statusOn(type, statementDate, dueDate, today),
    policyVersion: policy.version,
    personId: record.personId,
    ofr: record.ofr,
    reminders: reminders.filter((r) => r.date >= today),
    skippedReminders: reminders.filter((r) => r.date < today),
  };
}

/**
 * The open status an obligation has on `today`: initial and final are due from creation, a
 * biennial waits for its statement date; all are overdue after the due date.
 */
export function statusOn(
  type: ObligationType,
  statementDate: CivilDate,
  dueDate: CivilDate,
  today: CivilDate,
): OpenStatus {
  if (today > dueDate) return 'overdue';
  if (type === 'biennial' && today < statementDate) return 'upcoming';
  return 'due';
}

function biennialStatementDate(year: number, policy: ObligationPolicy): CivilDate {
  return atMonthDay(year, policy.biennial.statementDate);
}

/** Why an open obligation the record no longer owes is cancelled. */
function cancelReason(
  old: ExistingObligation,
  record: RosterSnapshot,
  policy: ObligationPolicy,
): CancelReason {
  if (old.type === 'final' && record.exitDate === null) return 'exit-reversed';
  if (old.type === 'biennial' && record.exitDate !== null) {
    const year = Number(old.cycleKey.slice('biennial:'.length));
    if (record.exitDate < biennialStatementDate(year, policy))
      return 'exited-before-statement-date';
  }
  // The appointment or exit date moved: an initial or final off its date, or a biennial whose
  // statement date now precedes the appointment.
  return 'superseded';
}
