import { OtpDelivery, OtpDeliveryFailed, type OtpMessage } from './otp-delivery.js';

/**
 * `OtpDelivery` for tests: keeps every message sent (with its code, which tests enter back),
 * fails the next sends on request, and holds the next send until released (to see what waits).
 */
export class InMemoryOtpDelivery extends OtpDelivery {
  private readonly messages: OtpMessage[] = [];
  private failures = 0;
  private hold: Promise<void> | undefined;
  /** Whether a send is waiting on `holdNext`'s release now. */
  holding = false;

  async send(message: OtpMessage): Promise<void> {
    const hold = this.hold;
    this.hold = undefined;
    if (hold) {
      this.holding = true;
      await hold;
      this.holding = false;
    }
    if (this.failures > 0) {
      this.failures -= 1;
      throw new OtpDeliveryFailed('failed on request');
    }
    this.messages.push(message);
  }

  /** Holds the next send until the returned function is called. */
  holdNext(): () => void {
    let release: () => void = () => undefined;
    this.hold = new Promise((resolve) => {
      release = resolve;
    });
    return release;
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
    this.hold = undefined;
    this.holding = false;
  }
}
