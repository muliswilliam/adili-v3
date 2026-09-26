import { type Delivery, MessageSender, type OutboundMessage } from './message-sender.js';

/** In-memory provider for tests: records what was sent and can be told to fail or hang. */
export class FakeMessageSender extends MessageSender {
  readonly sent: OutboundMessage[] = [];
  private behaviour: { kind: 'deliver' } | { kind: 'fail'; error: Error } | { kind: 'hang' } = {
    kind: 'deliver',
  };

  constructor(private readonly name: string) {
    super();
  }

  send(message: OutboundMessage, signal: AbortSignal): Promise<Delivery> {
    const behaviour = this.behaviour;
    if (behaviour.kind === 'fail') {
      return Promise.reject(behaviour.error);
    }
    if (behaviour.kind === 'hang') {
      // Like a stalled provider: settles only when the caller gives up.
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(signal.reason as Error);
        });
      });
    }
    this.sent.push(message);
    return Promise.resolve({ providerMessageId: `fake-${this.name}-${this.sent.length}` });
  }

  /** Every following send rejects with `error`. */
  fail(error: Error): void {
    this.behaviour = { kind: 'fail', error };
  }

  /** Every following send waits until aborted. */
  hang(): void {
    this.behaviour = { kind: 'hang' };
  }

  reset(): void {
    this.sent.length = 0;
    this.behaviour = { kind: 'deliver' };
  }
}
