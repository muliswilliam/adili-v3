/**
 * When a `FilingObligationWorkflow` acts (spec 04, ADR-003): the obligation turns due at the start
 * of its statement date, each reminder goes out around midday Nairobi time on its day (due date
 * minus the offset) shifted by a jitter that spreads 1.5 million reminders over hours, and the
 * obligation turns overdue at the start of the day after its due date. Pure and deterministic:
 * the workflow computes it from its own clock, so replays agree.
 */
import { addDays, type CivilDate } from '../dates.js';
import { type ObligationType, type OpenStatus, statusOn } from '../engine.js';

const HOUR_MS = 60 * 60 * 1000;
/** Kenya is UTC+3 all year (no daylight saving). */
const NAIROBI_OFFSET_MS = 3 * HOUR_MS;
/** Reminders are centred on midday so the default ±6 hour jitter keeps them between 06:00 and 18:00. */
const REMINDER_HOUR = 12;

/** What the workflow's timers are computed from, as `loadObligation` reads it. */
export interface ObligationSchedule {
  obligationId: string;
  type: ObligationType;
  statementDate: CivilDate;
  dueDate: CivilDate;
  /** Days before the due date, from the Commission's policy. */
  reminderOffsetsDays: readonly number[];
  /** Reminders are shifted by up to this much either way. */
  jitterWindowMs: number;
}

export type TimelineStep =
  | { kind: 'status'; status: 'due' | 'overdue'; at: number }
  | { kind: 'reminder'; offsetDays: number; at: number };

/** A reminder whose day passed before the workflow could send it. */
export interface MissedReminder {
  offsetDays: number;
  scheduledAt: number;
}

export interface Timeline {
  /** The status the obligation should have now. */
  status: OpenStatus;
  /** Reminders not yet recorded whose day is before today: recorded as skipped, never sent. */
  missed: MissedReminder[];
  /** What is still to come, in order. A step whose time has passed (earlier today) is due now. */
  steps: TimelineStep[];
}

/**
 * The obligation's timeline as of `now`, leaving out reminders already recorded (`done`). As in
 * the obligation engine, a reminder is still sent on its own day even if its slot passed, and
 * one from an earlier day is missed.
 */
export function timeline(
  schedule: ObligationSchedule,
  now: number,
  done: ReadonlySet<number>,
): Timeline {
  const { type, statementDate, dueDate } = schedule;
  const today = nairobiDateOf(now);
  const jitter = jitterMs(schedule.obligationId, schedule.jitterWindowMs);
  const missed: MissedReminder[] = [];
  const steps: TimelineStep[] = [];

  if (type === 'biennial' && statementDate > today) {
    steps.push({ kind: 'status', status: 'due', at: startOfNairobiDay(statementDate) });
  }
  for (const offsetDays of [...new Set(schedule.reminderOffsetsDays)].sort((a, b) => b - a)) {
    if (done.has(offsetDays)) continue;
    const day = addDays(dueDate, -offsetDays);
    const at = startOfNairobiDay(day) + REMINDER_HOUR * HOUR_MS + jitter;
    if (day < today) missed.push({ offsetDays, scheduledAt: at });
    else steps.push({ kind: 'reminder', offsetDays, at });
  }
  if (dueDate >= today) {
    steps.push({ kind: 'status', status: 'overdue', at: startOfNairobiDay(addDays(dueDate, 1)) });
  }

  steps.sort((a, b) => a.at - b.at);
  return { status: statusOn(type, statementDate, dueDate, today), missed, steps };
}

/**
 * The obligation's reminder jitter: uniform in ±`windowMs`, derived from the obligation id alone
 * (FNV-1a), so every run and replay of its workflow picks the same instant.
 */
export function jitterMs(obligationId: string, windowMs: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < obligationId.length; i += 1) {
    hash ^= obligationId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const unit = hash / 0x1_0000_0000;
  return Math.round((2 * unit - 1) * windowMs);
}

/** Midnight at the start of a civil date in Nairobi, as epoch milliseconds. */
export function startOfNairobiDay(date: CivilDate): number {
  return Date.parse(`${date}T00:00:00+03:00`);
}

/** The civil date in Nairobi at an instant (no `Intl`: fixed offset, safe in the workflow sandbox). */
export function nairobiDateOf(instant: number): CivilDate {
  return new Date(instant + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);
}
