/** The notifications templates the reporting service sends (notifications.yaml `TemplateId`). */
export type ReportingTemplate =
  'form-m-draft-ready-email' | 'form-m-reminder-email' | 'form-m-receipt-email';

/**
 * A templated email to a staff member's sign-in address (notifications.yaml `SendMessage` with
 * an address recipient).
 */
export interface StaffEmail {
  to: string;
  template: ReportingTemplate;
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
  abstract send(message: StaffEmail): Promise<SentMessage>;
}
