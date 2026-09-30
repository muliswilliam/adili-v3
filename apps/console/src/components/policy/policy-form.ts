import type {
  DirectoryError,
  TenantPolicyHistory,
  TenantPolicyVersion,
} from '../../server/directory/client';
import { formatNumber } from '../format';
import { messages as m } from './messages';

/** "30, 14 and 7 days before due", earliest reminder first. */
export function reminderOffsetsText(offsets: readonly number[]): string {
  if (offsets.length === 0) return m.remindersNone;
  const words = [...offsets].sort((a, b) => b - a).map(formatNumber);
  const last = words.pop() ?? '';
  return m.remindersBeforeDue(words.length > 0 ? `${words.join(', ')} and ${last}` : last);
}

/** Every version, newest first: the one in force, then those it replaced. */
export function policyVersions(history: TenantPolicyHistory): TenantPolicyVersion[] {
  return [history.current, ...[...history.previous].sort((a, b) => b.version - a.version)];
}

/** A real calendar date as `YYYY-MM-DD`, as the date field gives it. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * The error of the start date field before any request, or undefined when it may be saved: a
 * real date that differs from the one in force (another version with the same date would change
 * nothing).
 */
export function checkStartDate(value: string, current: string): string | undefined {
  if (!isCalendarDate(value)) return m.dateInvalid;
  if (value === current) return m.dateUnchanged;
  return undefined;
}

export type PolicyAlert =
  'rejected' | 'error' | 'in-progress' | 'changed' | 'forbidden' | 'not-found';

/** How the dialog shows a new version the directory did not create. */
export interface PolicyFailure {
  fieldError: string | undefined;
  /** Problem messages that name no field; listed under the alert. */
  unmapped: string[];
  alert: PolicyAlert;
  /**
   * The directory stored this outcome against the Idempotency-Key, so a changed request needs a
   * new key. False after network errors, 5xx and a key still in use: the retry reuses the key.
   */
  newKey: boolean;
}

export function policyFailure(error: DirectoryError): PolicyFailure {
  const failure: PolicyFailure = {
    fieldError: undefined,
    unmapped: [],
    alert: 'error',
    newKey: false,
  };
  if (error.kind !== 'problem') return failure;
  const { problem } = error;
  if (problem.type === 'idempotency-key-in-use') return { ...failure, alert: 'in-progress' };
  failure.newKey = true;
  if (problem.status === 403) return { ...failure, alert: 'forbidden' };
  if (problem.status === 404) return { ...failure, alert: 'not-found' };
  // Another version was created meanwhile, or the request no longer fits the one in force.
  if (problem.status === 409 || problem.status === 422) return { ...failure, alert: 'changed' };
  if (problem.status !== 400) return failure;

  for (const { path, message } of problem.errors ?? []) {
    if (path === 'obligationsStartDate') failure.fieldError ??= m.dateInvalid;
    else failure.unmapped.push(path ? `${path}: ${message}` : message);
  }
  if (!problem.errors?.length && problem.detail) failure.unmapped.push(problem.detail);
  return { ...failure, alert: 'rejected' };
}
