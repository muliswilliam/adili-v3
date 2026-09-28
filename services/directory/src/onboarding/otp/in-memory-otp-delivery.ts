import { OtpDelivery, OtpDeliveryFailed, type OtpMessage } from './otp-delivery.js';

/**
 * `OtpDelivery` for tests: keeps every message sent (with its code, which tests enter back),
 * and fails the next sends on request.
 */
export class InMemoryOtpDelivery extends OtpDelivery {
  private readonly messages: OtpMessage[] = [];
  private failures = 0;

  send(message: OtpMessage): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new OtpDeliveryFailed('failed on request'));
    }
    this.messages.push(message);
    return Promise.resolve();
  }

  /** Messages sent, oldest first; to one address or number when `to` is given. */
  sent(to?: string): OtpMessage[] {
    return this.messages.filter((message) => to === undefined || message.to === to);
  }

  /** The latest message sent, to `to` when given. */
  last(to?: string): OtpMessage | undefined {
    return this.sent(to).at(-1);
  }

  /** Makes the next `count` sends fail. */
  failNext(count = 1): void {
    this.failures = count;
  }

  reset(): void {
    this.messages.length = 0;
    this.failures = 0;
  }
}
