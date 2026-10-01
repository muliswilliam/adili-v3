import type { ProposerKind } from '../approvals/schema.js';
import type { ReferralGrounds } from './schema.js';

/**
 * Events the review service publishes about referrals to EACC (spec 08, outbox, CloudEvents). The
 * reporting service (spec 09) consumes them: `referral.sent.v1` is EACC's intake, the others count
 * referrals per Commission and cycle. Identifiers, grounds, states and actors only: never the
 * narrative, the decline note, names, the evidence or its hashes. The tenant extension is the
 * Commission's slug and the subject the referral id. The declarant is never told of a referral,
 * and no event names a channel to them.
 */
export const REFERRAL_PROPOSED = 'referral.proposed.v1';
export const REFERRAL_APPROVED = 'referral.approved.v1';
export const REFERRAL_DECLINED = 'referral.declined.v1';
export const REFERRAL_SENT = 'referral.sent.v1';

/** What every `referral.*` event carries. */
export interface ReferralEventBase extends Record<string, unknown> {
  referralId: string;
  /** The Commission's slug (also the CloudEvents `tenant` extension). */
  tenant: string;
  grounds: ReferralGrounds;
  /** The cycle the referral is about (the case's, or the later missed biennial cycle's). */
  cycleYear: number;
  /** The person referred: an identifier, for EACC's intake to match (spec 09). */
  personId: string;
  proposerKind: ProposerKind;
}

/** `referral.proposed.v1`: a reviewer or the referral sweep proposed a referral. */
export interface ReferralProposedData extends ReferralEventBase {
  /** The proposing officer's subject; null for the system. */
  proposer: string | null;
}

/** `referral.approved.v1`: a supervisor approved it and the `RFL` reference was allocated. */
export interface ReferralApprovedData extends ReferralEventBase {
  approver: string;
  /** `RFL-<ISSUER>-<YEAR>-<SEQ>-<CHECK>`. */
  reference: string;
}

/** `referral.declined.v1`: a supervisor declined it (the note stays in the service). */
export interface ReferralDeclinedData extends ReferralEventBase {
  declinedBy: string;
}

/**
 * `referral.sent.v1`: the Confidential evidence package is issued and the referral is sent to
 * EACC. Spec 09's intake stores it and pulls the package by its document id.
 */
export interface ReferralSentData extends ReferralEventBase {
  approver: string;
  reference: string;
  /** The Confidential `referral-package` document of the documents service. */
  packageDocumentId: string;
  /** ISO 8601. */
  sentAt: string;
}

/** Any `referral.*` event's data. */
export type ReferralEventData =
  ReferralProposedData | ReferralApprovedData | ReferralDeclinedData | ReferralSentData;
