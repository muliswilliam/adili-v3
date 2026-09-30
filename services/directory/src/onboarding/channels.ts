import type { ContactChannel } from '@adili/contacts';

import { normaliseEmail, normalisePhone } from '../roster/normalise.js';
import type { rosterRecords } from '../roster/schema.js';
import type { onboardingSessions } from './schema.js';
import type { OnboardingState, TerminalState } from './session-state.js';

type SessionColumn = keyof typeof onboardingSessions.$inferSelect;
type RosterColumn = keyof typeof rosterRecords.$inferSelect;
type LiveState = Exclude<OnboardingState, TerminalState>;

/** What onboarding does differently per contact channel, in one place. */
export interface ChannelDefinition {
  /** The channel's steps in the session's state machine (`session-state.ts`). */
  states: { contactRequired: LiveState; pending: LiveState; verified: LiveState };
  /** The channel verified after this one, if any: email first, then phone. */
  next: ContactChannel | null;
  /** A contact as the declarant typed it, normalised, or null when it is not a valid one. */
  normalise: (value: string) => string | null;
  /** The validation message for a contact `normalise` refuses. */
  invalidMessage: string;
  /** The session's columns of the channel's contact. */
  session: { value: SessionColumn; source: SessionColumn; verifiedAt: SessionColumn };
  /** The roster record's columns of the channel's contact. */
  roster: { value: RosterColumn; source: RosterColumn };
}

export const CHANNELS = {
  email: {
    states: {
      contactRequired: 'email-contact-required',
      pending: 'email-pending',
      verified: 'email-verified',
    },
    next: 'phone',
    normalise: normaliseEmail,
    invalidMessage: 'Enter a valid email address',
    session: { value: 'email', source: 'emailSource', verifiedAt: 'emailVerifiedAt' },
    roster: { value: 'email', source: 'emailSource' },
  },
  phone: {
    states: {
      contactRequired: 'phone-contact-required',
      pending: 'phone-pending',
      verified: 'phone-verified',
    },
    next: null,
    normalise: normalisePhone,
    invalidMessage: 'Enter a valid phone number, e.g. 0712345678 or +254712345678',
    session: { value: 'phone', source: 'phoneSource', verifiedAt: 'phoneVerifiedAt' },
    roster: { value: 'phone', source: 'phoneSource' },
  },
} as const satisfies Record<ContactChannel, ChannelDefinition>;

const ENTRIES = Object.entries(CHANNELS) as [ContactChannel, ChannelDefinition][];

/** The channel whose code the session waits for, if any. */
export function pendingChannel(state: OnboardingState): ContactChannel | null {
  return ENTRIES.find(([, channel]) => channel.states.pending === state)?.[0] ?? null;
}

/** The channel whose contact the session waits for the declarant to supply, if any. */
export function contactRequiredChannel(state: OnboardingState): ContactChannel | null {
  return ENTRIES.find(([, channel]) => channel.states.contactRequired === state)?.[0] ?? null;
}
