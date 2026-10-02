import { tenantEvent } from '../../tenant-event.js';
import type { EventActor } from '../actor.js';

/**
 * Events about a Commission's roster records (spec 10), recorded in the transaction of the change
 * (they are also its audit record, ADR-008). Ids and channels only, never the roster's contacts.
 * The `tenant` extension is the Commission's slug.
 */

export const ROSTER_ONBOARDING_INVITATION_SENT = 'roster.onboarding-invitation.sent.v1';

export interface OnboardingInvitationSentData extends Record<string, unknown> {
  invitationId: string;
  rosterRecordId: string;
  /** The channels the invitation went out on (none when the roster holds no contact). */
  channels: string[];
  /** Who asked: the calling service's client (the access service, for an access request). */
  actor: EventActor;
}

/** An officer who has not onboarded was invited to; the subject is the invitation. */
export const onboardingInvitationSent = tenantEvent<OnboardingInvitationSentData>(
  ROSTER_ONBOARDING_INVITATION_SENT,
  (data) => data.invitationId,
);
