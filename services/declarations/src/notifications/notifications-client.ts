/**
 * The notifications service, as the reminder activity and the acknowledgement need it: send one
 * templated message to a person on one channel. Notifications resolves the person's verified contact through the
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
  /** The Commission's slug: the person's contacts are read there, and it is stored for audit. */
  tenant: string;
  params: ReminderParams;
  /**
   * The same for every attempt at this channel of this reminder, so notifications sends it once
   * however often the request is retried (`Idempotency-Key`).
   */
  idempotencyKey: string;
}

/** Parameters of the `acknowledgement-email` and `acknowledgement-sms` templates (spec 06). */
export interface AcknowledgementParams {
  /** The declaration's reference number, e.g. `DCB-PSC-2027-0000001-K`. */
  reference: string;
  /** The type the reference names. */
  type: 'initial' | 'biennial' | 'final';
  /** Above 1 the copy names the version: an amendment. */
  version: number;
  /** 1 to 120 characters. */
  commissionName: string;
  statementDate: string;
  /** The slip's verification code, as printed under its QR code. */
  verificationCode: string;
  /** Where the slip downloads behind sign-in (the portal). */
  portalUrl: string;
}

/** A version's acknowledgement, told to its declarant on one channel. */
export interface AcknowledgementMessage {
  channel: ReminderChannel;
  personId: string;
  /** The Commission's slug: the person's contacts are read there, and it is stored for audit. */
  tenant: string;
  params: AcknowledgementParams;
  /**
   * The same for every attempt at this channel of this version's acknowledgement, so a
   * redelivered `document.issued.v1` never sends it twice (`Idempotency-Key`).
   */
  idempotencyKey: string;
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

/**
 * Notifications already took another request under this `Idempotency-Key` (422): a message went
 * out, or failed, with a body other than this one. Resending the same body cannot help.
 */
export class NotificationsKeyReused extends Error {
  override readonly name = 'NotificationsKeyReused';
}

export abstract class NotificationsClient {
  /**
   * Throws `NotificationsUnavailable`, `NotificationsRejected` or `NotificationsKeyReused` when no
   * outcome is known.
   */
  abstract sendReminder(message: ReminderMessage): Promise<SendOutcome>;

  /** The acknowledgement templates; throws like `sendReminder`. */
  abstract sendAcknowledgement(message: AcknowledgementMessage): Promise<SendOutcome>;
}
