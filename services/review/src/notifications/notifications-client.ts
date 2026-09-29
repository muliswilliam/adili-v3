/** notifications.yaml `Channel`. */
export type Channel = 'email' | 'sms';

/** The notifications templates the review service sends (notifications.yaml `TemplateId`). */
export type ReviewTemplate =
  | 'clarification-issued-email'
  | 'clarification-issued-sms'
  | 'clarification-reminder-email'
  | 'clarification-reminder-sms'
  | 'decision-email'
  | 'decision-sms'
  | 'notice-email'
  | 'notice-sms';

/**
 * A templated message to a person, whose verified contacts the notifications service resolves
 * through the directory (notifications.yaml `SendMessage` with a `person` recipient).
 */
export interface PersonMessage {
  channel: Channel;
  personId: string;
  template: ReviewTemplate;
  /** Validated by notifications against the template's parameters. */
  params: Record<string, string | number>;
  /** The Commission, for audit and branding. */
  tenant: string;
  /**
   * The same key for the same logical message, so a retried send is not delivered twice
   * (`Idempotency-Key`).
   */
  idempotencyKey: string;
}

/** notifications.yaml `Message`: handed to the provider, or failed (e.g. `no-contact`). */
export interface SentMessage {
  id: string;
  status: 'sent' | 'failed';
  error: string | null;
}

/** The notifications service is unreachable or answered outside its contract; activities retry. */
export class NotificationsUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NotificationsUnavailable';
  }
}

/**
 * The notifications service's `sendMessage`, one synchronous hop per message (ADR-013). A Nest
 * token: the service uses `HttpNotificationsClient`, tests a fake.
 */
export abstract class NotificationsClient {
  /** Throws `InternalApiRejected` when notifications refuses the message. */
  abstract send(message: PersonMessage): Promise<SentMessage>;
}
