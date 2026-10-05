import type { SeedConfig } from '../config.js';
import { requestJson } from './http.js';

/**
 * The demo's inboxes: Mailpit for email and the SMS mock. Onboarding sends its codes there, as
 * it would to the officer's phone and email, and the seed reads them like the officer would.
 */
export class Inboxes {
  constructor(private readonly config: SeedConfig) {}

  /** The newest 6-digit code emailed to `to` after `since`, if any. */
  async emailCode(to: string, since: Date): Promise<string | undefined> {
    const { body } = await requestJson<{ messages: { ID: string; Created: string }[] }>(
      `${this.config.MAILPIT_URL}/api/v1/search?limit=5&query=${encodeURIComponent(`to:"${to}"`)}`,
      { what: `search Mailpit for ${to}` },
    );
    const latest = body.messages.find((message) => new Date(message.Created) >= since);
    if (!latest) return undefined;
    const { body: message } = await requestJson<{ Text: string }>(
      `${this.config.MAILPIT_URL}/api/v1/message/${latest.ID}`,
      { what: `read Mailpit message ${latest.ID}` },
    );
    return /\b(\d{6})\b/.exec(message.Text)?.[1];
  }

  /** The newest code the SMS mock sent to `to`, with its message id. */
  async smsCode(to: string): Promise<{ code: string; messageId: string } | undefined> {
    const { status, body } = await requestJson<{ code: string; message_id: string }>(
      `${this.config.MOCKS_URL}/sms/otp?to=${encodeURIComponent(to)}`,
      { what: `read SMS code for ${to}`, allow: [404] },
    );
    return status === 404 ? undefined : { code: body.code, messageId: body.message_id };
  }

  /** How many emails Mailpit holds for `to` whose subject contains `subject`. */
  async countEmails(to: string, subject: string): Promise<number> {
    const { body } = await requestJson<{ messages_count: number }>(
      `${this.config.MAILPIT_URL}/api/v1/search?limit=1&query=${encodeURIComponent(`to:"${to}" subject:"${subject}"`)}`,
      { what: `count Mailpit messages for ${to}` },
    );
    return body.messages_count;
  }
}
