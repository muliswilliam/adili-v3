import type { ConfirmExits, DirectoryError } from '../../server/directory/client';
import { messages as m } from './messages';

/*
 * The flagged officers screen's selection and the confirm exits dialog's dates (spec 02 FE-7,
 * S25), and how the directory's answers are told to the reporting officer.
 */

// ---------------------------------------------------------------------------------------------
// Selection

/** Ids of the selected officers, in the order they were selected. */
export type Selection = readonly string[];

export type SelectionAction =
  /** The table's new selection: one row toggled, or every row on the page ("Select all on page"). */
  | { type: 'set'; ids: Iterable<string> }
  | { type: 'clear' }
  /** The list reloaded: keep only the officers still on it (the others were exited or kept). */
  | { type: 'retain'; ids: readonly string[] };

export function selectionReducer(selection: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case 'set': {
      const next = new Set(action.ids);
      // Keep the order of what stays selected, then add the new ones in the table's order.
      const kept = selection.filter((id) => next.has(id));
      const added = [...next].filter((id) => !selection.includes(id));
      return kept.length === selection.length && added.length === 0
        ? selection
        : [...kept, ...added];
    }
    case 'clear':
      return selection.length === 0 ? selection : [];
    case 'retain': {
      const listed = new Set(action.ids);
      const next = selection.filter((id) => listed.has(id));
      return next.length === selection.length ? selection : next;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Exit dates

/** An officer in the confirm exits dialog. */
export interface ExitingOfficer {
  id: string;
  fullName: string;
  personnelFileNumber: string;
}

export interface ExitDates {
  /** Applies to every officer without their own date; `YYYY-MM-DD` as the date input gives it. */
  exitDate: string;
  /** Per-officer dates by record id; an empty string is no override. */
  overrides: Readonly<Record<string, string>>;
}

export type ExitDatesAction =
  { type: 'exit-date'; date: string } | { type: 'override'; id: string; date: string };

/** Opens with today as the exit date and nobody with a date of their own. */
export function initialExitDates(today: string): ExitDates {
  return { exitDate: today, overrides: {} };
}

export function exitDatesReducer(dates: ExitDates, action: ExitDatesAction): ExitDates {
  if (action.type === 'exit-date') return { ...dates, exitDate: action.date };
  const others = Object.entries(dates.overrides).filter(([id]) => id !== action.id);
  const overrides = Object.fromEntries(
    action.date ? [...others, [action.id, action.date] as const] : others,
  );
  return { ...dates, overrides };
}

const KENYAN_DATE = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Africa/Nairobi',
});

/** Today in Kenya as `YYYY-MM-DD`: exit dates may not be after it (the directory's rule). */
export function todayInNairobi(now: Date = new Date()): string {
  return KENYAN_DATE.format(now);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function dateError(value: string, today: string): string | undefined {
  if (!isCalendarDate(value)) return m.exitDateInvalid;
  // ISO dates compare as strings.
  if (value > today) return m.exitDateFuture;
  return undefined;
}

/** What is wrong with the dates: the batch date, and officers' own dates by record id. */
export interface ExitDateErrors {
  exitDate?: string;
  overrides: Record<string, string>;
}

export function hasExitDateErrors(errors: ExitDateErrors): boolean {
  return errors.exitDate !== undefined || Object.keys(errors.overrides).length > 0;
}

export type ExitsCheck = { ok: true; exits: ConfirmExits } | { ok: false; errors: ExitDateErrors };

/**
 * The request for the dialog's dates, or what to fix first. The exit date may be left empty
 * only when every officer has their own; no date may be after `today`.
 */
export function checkExits(
  officers: readonly ExitingOfficer[],
  dates: ExitDates,
  today: string,
): ExitsCheck {
  const errors: ExitDateErrors = { overrides: {} };
  const own = (id: string) => dates.overrides[id] ?? '';
  const batch = dates.exitDate.trim();
  if (batch) {
    const error = dateError(batch, today);
    if (error) errors.exitDate = error;
  } else if (officers.some((officer) => !own(officer.id))) {
    errors.exitDate = m.exitDateRequired;
  }
  for (const officer of officers) {
    const date = own(officer.id);
    const error = date ? dateError(date, today) : undefined;
    if (error) errors.overrides[officer.id] = error;
  }
  if (hasExitDateErrors(errors)) return { ok: false, errors };

  const records = officers.map((officer) => {
    const date = own(officer.id);
    // A date equal to the batch's says nothing more.
    return date && date !== batch
      ? { recordId: officer.id, exitDate: date }
      : { recordId: officer.id };
  });
  return { ok: true, exits: batch ? { exitDate: batch, records } : { records } };
}

// ---------------------------------------------------------------------------------------------
// Failures

export type ExitsFailure =
  /** The session ended: sign in again and come back. */
  | { kind: 'sign-in' }
  /**
   * Some officers were exited or left the roster since the page loaded: nothing was recorded, the
   * page reloads and the dialog closes.
   */
  | { kind: 'stale'; message: string }
  /** The dialog stays open with `message` above the dates and `errors` on them. */
  | {
      kind: 'failed';
      message: string | null;
      errors: ExitDateErrors;
      /** The directory stored an outcome for the key: the next attempt needs a new one. */
      newKey: boolean;
    };

/** Index of the record in `records.3.exitDate`-style error paths. */
const RECORD_PATH = /^records\.(\d+)\.exitDate$/;

/** How a failed confirm exits is told, from the directory's answer. */
export function exitsFailure(
  officers: readonly ExitingOfficer[],
  error: DirectoryError,
): ExitsFailure {
  const retry = m.exitsFailed(officers.length);
  if (error.kind === 'unauthenticated') return { kind: 'sign-in' };
  if (error.kind === 'unavailable') {
    return { kind: 'failed', message: retry, errors: { overrides: {} }, newKey: false };
  }
  const { problem } = error;
  if (problem.type === 'record-exited' || problem.type === 'record-not-found') {
    return { kind: 'stale', message: m.exitsStale };
  }
  if (problem.status === 403) {
    return { kind: 'failed', message: m.exitsForbidden, errors: { overrides: {} }, newKey: true };
  }
  if (problem.status === 400) {
    // Dates the checks here let through (the directory's today is later than the browser's, or
    // earlier): put the directory's messages on the fields they name.
    const errors: ExitDateErrors = { overrides: {} };
    let unmapped = false;
    for (const entry of problem.errors ?? []) {
      const record = RECORD_PATH.exec(entry.path);
      const officer = record ? officers[Number(record[1])] : undefined;
      if (entry.path === 'exitDate') errors.exitDate = dateMessage(entry.message);
      else if (officer) errors.overrides[officer.id] = dateMessage(entry.message);
      else unmapped = true;
    }
    const mapped = hasExitDateErrors(errors);
    return { kind: 'failed', message: mapped && !unmapped ? null : retry, errors, newKey: true };
  }
  return { kind: 'failed', message: retry, errors: { overrides: {} }, newKey: true };
}

/** The directory's wording of a date problem, in the console's words where it is known. */
function dateMessage(message: string): string {
  if (/future/i.test(message)) return m.exitDateFuture;
  if (/enter an exit date/i.test(message)) return m.exitDateRequired;
  return message;
}

/** How a failed "Still employed" is told: a toast, or a new sign-in. */
export function keepFailure(
  error: DirectoryError,
): { kind: 'sign-in' } | { kind: 'failed'; message: string } {
  if (error.kind === 'unauthenticated') return { kind: 'sign-in' };
  if (error.kind === 'problem' && error.problem.status === 403) {
    return { kind: 'failed', message: m.keepForbidden };
  }
  return { kind: 'failed', message: m.keepFailed };
}
