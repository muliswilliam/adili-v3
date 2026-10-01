import { z } from 'zod';

import type { RegistryAdapter } from '../../src/adapter-kit/registry-adapter.js';
import { UpstreamError } from '../../src/adapter-kit/upstream-error.js';
import type { System } from '../../src/db/schema.js';

export const stubRecordSchema = z.object({
  owner: z.string(),
  registrations: z.array(z.string()),
});
export type StubRecord = z.infer<typeof stubRecordSchema>;

/** What the stub registry does with the next calls. */
export type StubAdapterBehaviour =
  { kind: 'registry' } | { kind: 'fail' } | { kind: 'hang' } | { kind: 'throw'; error: Error };

/**
 * A registry adapter without a registry: answers from `records`, counts calls and notes when
 * each began, and fails or hangs on demand, so kit tests can tell cache hits from calls and
 * drive the breaker, rate limit and timeout.
 */
export class StubAdapter implements RegistryAdapter<StubRecord> {
  readonly operation = 'records';
  readonly schema = stubRecordSchema;
  readonly records = new Map<string, StubRecord>();
  /** `performance.now()` at the start of each call. */
  readonly callTimes: number[] = [];
  behaviour: StubAdapterBehaviour = { kind: 'registry' };
  /** How long the last hanging call ran before its signal aborted; null until one did. */
  abortedAfterMs: number | null = null;

  constructor(readonly system: System) {}

  get calls(): number {
    return this.callTimes.length;
  }

  reset(): void {
    this.records.clear();
    this.callTimes.length = 0;
    this.behaviour = { kind: 'registry' };
    this.abortedAfterMs = null;
  }

  async fetch(subject: string, signal: AbortSignal): Promise<StubRecord | null> {
    this.callTimes.push(performance.now());
    const behaviour = this.behaviour;
    switch (behaviour.kind) {
      case 'fail':
        throw new UpstreamError('upstream-error', 'Stub registry answered 503');
      case 'throw':
        throw behaviour.error;
      case 'hang':
        return new Promise((_, reject) => {
          const started = performance.now();
          signal.addEventListener('abort', () => {
            this.abortedAfterMs = performance.now() - started;
            reject(new UpstreamError('upstream-error', 'Stub registry call aborted'));
          });
        });
      case 'registry':
        return this.records.get(subject) ?? null;
    }
  }
}
