/**
 * The notifications service, as the reminder activity needs it: send one templated reminder to a
 * person on one channel. Notifications resolves the person's verified contact through the
 * directory (spec 04 BE-3). A Nest token: tests replace it with a fake.
 */

export type ReminderChannel = 'sms' | 'email';

/** Parameters of the `obligation-reminder-sms` and `obligation-reminder-email` templates. */
export interface ReminderParams {
  type: 'initial' | 'biennial' | 'final';
  /** 1 to 120 characters. */
  commissionName: string;
  statementDate: string;
  dueDate: string;
  /** 0 to 366; 0 reads "today". */
  daysLeft: number;
  portalUrl: string;
}

export interface ReminderMessage {
  channel: ReminderChannel;
  personId: string;
  /** The Commission's slug, stored with the message for audit. */
  tenant: string;
  params: ReminderParams;
}

/**
 * What notifications made of a message: `sent` with its id, or `failed` with its reason
 * (`no-contact`, `contact-lookup-failed`, `timeout`, `rejected-recipient`, `provider-error`).
 */
export type SendOutcome =
  { status: 'sent'; messageId: string } | { status: 'failed'; error: string };

/** Notifications could not be asked (unreachable, no token, an unexpected answer): retry later. */
export class NotificationsUnavailable extends Error {
  override readonly name = 'NotificationsUnavailable';
}

/** Notifications refused the request itself (400): retrying the same message cannot help. */
export class NotificationsRejected extends Error {
  override readonly name = 'NotificationsRejected';
}

export abstract class NotificationsClient {
  /** Throws `NotificationsUnavailable` or `NotificationsRejected` when no outcome is known. */
  abstract sendReminder(message: ReminderMessage): Promise<SendOutcome>;
}
