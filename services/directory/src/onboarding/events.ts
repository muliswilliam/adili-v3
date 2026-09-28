import { tenantEvent } from '../tenant-event.js';
import type { EndReason, OnboardingState } from './session-state.js';

/**
 * Events of declarant onboarding (spec 03): the audit trail of every session state change, and
 * what downstream services act on. Ids and states only: never a national ID, file number, name,
 * contact or code (ADR-013 §3). The `tenant` extension is the Commission's slug.
 */

export const ONBOARDING_SESSION_STARTED = 'onboarding.session.started.v1';

export interface OnboardingSessionStartedData extends Record<string, unknown> {
  sessionId: string;
  rosterRecordId: string;
}

/** Identify matched a roster record and a session began (state `identified`). */
export const onboardingSessionStarted = tenantEvent<OnboardingSessionStartedData>(
  ONBOARDING_SESSION_STARTED,
  (data) => data.sessionId,
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
export const onboardingSessionAdvanced = tenantEvent<OnboardingSessionAdvancedData>(
  ONBOARDING_SESSION_ADVANCED,
  (data) => data.sessionId,
);

export const ONBOARDING_SESSION_ENDED = 'onboarding.session.ended.v1';

export interface OnboardingSessionEndedData extends Record<string, unknown> {
  sessionId: string;
  /** `confirmed`, `identity-mismatch`, `expired` (ran out of time) or `rate-limited`. */
  outcome: EndReason;
}

/** A session reached a terminal state, for audit and abuse analytics. */
export const onboardingSessionEnded = tenantEvent<OnboardingSessionEndedData>(
  ONBOARDING_SESSION_ENDED,
  (data) => data.sessionId,
);

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
