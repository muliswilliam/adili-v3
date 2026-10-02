import type { NewEvent } from '@adili/events';

import type { IdentityDocumentKind, IdentityStatus } from '../persons/schema.js';
import { tenantEvent } from '../tenant-event.js';
import type { EndReason, OnboardingKind, OnboardingState } from './session-state.js';

/**
 * Events of onboarding, declarants' (spec 03) and applicants' (spec 10): the audit trail of every
 * session state change, and what downstream services act on. Ids and states only: never a
 * national ID, passport or file number, name, contact or code (ADR-013 §3). The `tenant`
 * extension is the Commission's slug; an applicant's session has none, so its events carry no
 * `tenant`.
 */

/**
 * The factory of one type of event about a session: `tenant` is the session's Commission, or
 * null for an applicant's session (then the event has no `tenant`).
 */
function sessionEvent<TData extends Record<string, unknown> & { sessionId: string }>(
  type: string,
): (tenant: string | null, data: TData) => NewEvent<TData> {
  return (tenant, data) => ({
    type,
    subject: data.sessionId,
    ...(tenant === null ? {} : { tenant }),
    data,
  });
}

export const ONBOARDING_SESSION_STARTED = 'onboarding.session.started.v1';

export interface OnboardingSessionStartedData extends Record<string, unknown> {
  sessionId: string;
  /** `applicant` for an applicant's session; absent (a declarant's) before spec 10. */
  kind?: OnboardingKind;
  /** The roster record a declarant's session is for; absent for an applicant's. */
  rosterRecordId?: string;
}

/**
 * A session began (state `identified`): identify matched a roster record, or an applicant
 * started (their national ID matched IPRS, or they gave a passport).
 */
export const onboardingSessionStarted = sessionEvent<OnboardingSessionStartedData>(
  ONBOARDING_SESSION_STARTED,
);

export const ONBOARDING_SESSION_ADVANCED = 'onboarding.session.advanced.v1';

export interface OnboardingSessionAdvancedData extends Record<string, unknown> {
  sessionId: string;
  /** The state before this change. */
  from: OnboardingState;
  /** The state the session is now in: never a terminal one (see ended). */
  state: OnboardingState;
}

/** A session moved to its next live state (a code sent, a contact verified, ...). */
export const onboardingSessionAdvanced = sessionEvent<OnboardingSessionAdvancedData>(
  ONBOARDING_SESSION_ADVANCED,
);

export const ONBOARDING_SESSION_ENDED = 'onboarding.session.ended.v1';

export interface OnboardingSessionEndedData extends Record<string, unknown> {
  sessionId: string;
  /** `confirmed`, `identity-mismatch`, `expired` (ran out of time) or `rate-limited`. */
  outcome: EndReason;
}

/** A session reached a terminal state, for audit and abuse analytics. */
export const onboardingSessionEnded =
  sessionEvent<OnboardingSessionEndedData>(ONBOARDING_SESSION_ENDED);

export const ONBOARDING_IDENTITY_MISMATCH = 'onboarding.identity-mismatch.v1';

export interface OnboardingIdentityMismatchData extends Record<string, unknown> {
  rosterRecordId: string;
  sessionId: string;
}

/** IPRS disagreed with the roster record at confirm; the record is flagged for its officer. */
export const onboardingIdentityMismatch = tenantEvent<OnboardingIdentityMismatchData>(
  ONBOARDING_IDENTITY_MISMATCH,
  (data) => data.rosterRecordId,
);

export const DECLARANT_ONBOARDED = 'declarant.onboarded.v1';

export interface DeclarantOnboardedData extends Record<string, unknown> {
  personId: string;
  ofr: string;
  rosterRecordId: string;
  keycloakUserId: string;
  /** The record was linked to the person's existing account rather than a new one. */
  linked: boolean;
}

/** A roster record became onboarded as a person (slice 04 creates filing obligations). */
export const declarantOnboarded = tenantEvent<DeclarantOnboardedData>(
  DECLARANT_ONBOARDED,
  (data) => data.rosterRecordId,
);

export const APPLICANT_ONBOARDED = 'applicant.onboarded.v1';

export interface ApplicantOnboardedData extends Record<string, unknown> {
  personId: string;
  keycloakUserId: string;
  sessionId: string;
  documentKind: IdentityDocumentKind;
  /** `verified` (IPRS matched the national ID) or `pending-verification` (a passport). */
  identityStatus: IdentityStatus;
}

/** Applicant onboarding completed: a person of kind `applicant` and their account (spec 10). */
export function applicantOnboarded(data: ApplicantOnboardedData): NewEvent<ApplicantOnboardedData> {
  return { type: APPLICANT_ONBOARDED, subject: data.personId, data };
}

export const APPLICANT_IDENTITY_MISMATCH = 'applicant.identity-mismatch.v1';

export interface ApplicantIdentityMismatchData extends Record<string, unknown> {
  /** The refused start, which leaves no session behind. */
  attemptId: string;
  /** Keyed hash of the client IP (as on sessions), null when unknown: for abuse analytics. */
  clientIpHash: string | null;
}

/**
 * IPRS knew no such national ID, or not under the names entered, when an applicant started
 * onboarding (spec 10): nothing is stored, but the refusal is recorded, as the declarant's
 * `onboarding.identity-mismatch.v1` is. No `tenant`: applicants belong to no Commission.
 */
export function applicantIdentityMismatch(
  data: ApplicantIdentityMismatchData,
): NewEvent<ApplicantIdentityMismatchData> {
  return { type: APPLICANT_IDENTITY_MISMATCH, subject: data.attemptId, data };
}

export const ONBOARDING_ABUSE_THRESHOLD = 'onboarding.abuse-threshold.v1';

export interface OnboardingAbuseThresholdData extends Record<string, unknown> {
  /** Start of the hour the failures were counted in, ISO 8601. */
  window: string;
  failures: number;
}

/**
 * Failed onboarding attempts against the Commission (`onboarding_failures`) reached
 * `ONBOARDING_ABUSE_THRESHOLD` in one hour: a stale roster or an attack. Recorded once per window.
 */
export const onboardingAbuseThreshold = tenantEvent<OnboardingAbuseThresholdData>(
  ONBOARDING_ABUSE_THRESHOLD,
  (_data, slug) => slug,
);
