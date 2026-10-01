/**
 * The notifications templates the access service sends (spec 10; notifications.yaml `TemplateId`
 * once notifications registers them, #258). One id per channel.
 */
export type AccessTemplate =
  | 'access-acknowledgement-email'
  | 'access-acknowledgement-sms'
  | 'access-request-notified-email'
  | 'access-request-notified-sms'
  | 'access-decision-applicant-email'
  | 'access-decision-declarant-email'
  | 'access-package-ready-email'
  | 'access-officer-reminder-email'
  | 'lea-grant-notice-email'
  | 'lea-decision-email'
  | 'certified-copy-ready-email';

/** Who receives a message: an address the caller holds, or a person whose contacts directory holds. */
export type Recipient = { kind: 'address'; to: string } | { kind: 'person'; personId: string };

/** A templated message (notifications.yaml `SendMessage`). */
export interface AccessMessage {
  channel: 'email' | 'sms';
  recipient: Recipient;
  template: AccessTemplate;
  /** Validated by notifications against the template's parameters. Ids and references only. */
  params: Record<string, string | number>;
  /** The Commission, for audit, branding and a person recipient's contacts. */
  tenant: string;
  /**
   * The same key for the same logical message, so a retried send is not delivered twice
   * (`Idempotency-Key`).
   */
  idempotencyKey: string;
}

/** notifications.yaml `Message`: handed to the provider, or failed. */
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
  abstract send(message: AccessMessage): Promise<SentMessage>;
}
