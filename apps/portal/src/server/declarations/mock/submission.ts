/**
 * The mock's submission rules (spec 06, `POST /v1/declarations/{id}/submit`), apart from the
 * draft store: the step-up check on the bearer token, the obligation's window, reference
 * allocation and the idempotent replay. `mock.server.ts` wires them to its drafts.
 */
import { STEP_UP_ACR, STEP_UP_WINDOW_SECONDS } from '@adili/bff-auth';
import { declarationSchemes, format } from '@adili/numbering/references';
import { formatCalendarDate } from '@adili/ui';

import type { Acknowledgement, CommissionRef, ObligationType } from '../types';
import { bearerClaims } from './obligations';

/**
 * Whether the bearer token carries a step-up (`acr`) with an `auth_time` at most five minutes
 * old, as the service checks it (S3). Unverified, like every claim the mock reads.
 */
export function hasStepUp(request: Request, now: number = Date.now()): boolean {
  const claims = bearerClaims(request);
  return (
    claims?.acr === STEP_UP_ACR &&
    typeof claims.auth_time === 'number' &&
    now / 1000 - claims.auth_time <= STEP_UP_WINDOW_SECONDS
  );
}

/** The obligation a draft was started for, as the submit rules need it. */
export interface MockFiling {
  statementDate: string;
  dueDate: string;
  cancelled: boolean;
}

export type FilingWindow = 'upcoming' | 'due' | 'overdue' | 'cancelled';

/** Where the obligation stands today (Kenyan calendar date). */
export function filingWindow(filing: MockFiling, now: number = Date.now()): FilingWindow {
  if (filing.cancelled) return 'cancelled';
  const today = formatCalendarDate(now);
  if (today < filing.statementDate) return 'upcoming';
  return today <= filing.dueDate ? 'due' : 'overdue';
}

const counters = new Map<string, number>();

/**
 * The next reference of the declaration's scheme for the Commission and the statement date's
 * year, gapless per (scheme, issuer, year) as the numbering package allocates them (ADR-011).
 */
export function allocateReference(
  type: ObligationType,
  commission: CommissionRef,
  statementDate: string,
): string {
  const scheme = declarationSchemes[type];
  const period = Number(statementDate.slice(0, 4));
  const key = `${scheme.code}:${commission.issuerCode}:${String(period)}`;
  const sequence = (counters.get(key) ?? 0) + 1;
  counters.set(key, sequence);
  return format(scheme, { issuer: commission.issuerCode, period, sequence });
}

/** A version's acknowledgement right after submission: the slip is issued asynchronously. */
export function pendingAcknowledgement(): Acknowledgement {
  return {
    status: 'pending',
    documentId: null,
    verificationId: null,
    verifyUrl: null,
    issuedAt: null,
    verifiedCount: 0,
    downloadUrl: null,
  };
}

/** Clears the reference counters (tests). */
export function resetSubmissionMock() {
  counters.clear();
}
