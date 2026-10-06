import { randomUUID } from 'node:crypto';

import {
  IntegrationGatewayClient,
  IntegrationGatewayUnavailable,
  type RegistryLookup,
} from '../../src/integration-gateway/integration-gateway-client.js';
import type { RegistryResult, RegistrySystem } from '../../src/suggestions/registry-results.js';

/** What the fake answers a lookup with: a result, or `down` for an unreachable gateway. */
export type FakeAnswer = RegistryResult | 'down';

/**
 * The integration-gateway's registry lookups for tests, recording every call with its headers.
 * Answers are given per system and national ID as a queue: each call takes the next answer, and
 * the last one keeps answering. A lookup nobody arranged answers `not-found` with no records.
 */
export class FakeIntegrationGateway extends IntegrationGatewayClient {
  readonly calls: RegistryLookup[] = [];
  private readonly answers = new Map<string, FakeAnswer[]>();
  private lookupHook: (() => Promise<void>) | undefined;

  /** Answers `answers` in turn to lookups of `nationalId` in `system`. */
  given(system: RegistrySystem, nationalId: string, ...answers: FakeAnswer[]): void {
    this.answers.set(key(system, nationalId), [...answers]);
  }

  callsTo(system: RegistrySystem): RegistryLookup[] {
    return this.calls.filter((call) => call.system === system);
  }

  /** Runs `hook` on each lookup, before the gateway answers: what happens while it is out. */
  onLookup(hook: () => Promise<void>): void {
    this.lookupHook = hook;
  }

  reset(): void {
    this.calls.length = 0;
    this.answers.clear();
    this.lookupHook = undefined;
  }

  async lookup(request: RegistryLookup): Promise<RegistryResult> {
    this.calls.push({ ...request });
    await this.lookupHook?.();
    const queue = this.answers.get(key(request.system, request.nationalId));
    const answer = queue && queue.length > 1 ? queue.shift() : queue?.[0];
    if (answer === 'down') throw new IntegrationGatewayUnavailable('The gateway is unreachable');
    return answer ?? notFound(request.system);
  }
}

function key(system: RegistrySystem, nationalId: string) {
  return `${system}:${nationalId}`;
}

/** The registry holds nothing for the person. */
export function notFound(system: RegistrySystem): RegistryResult {
  const envelope = {
    resultId: randomUUID(),
    outcome: 'not-found' as const,
    reason: null,
    cached: false,
    checkedAt: new Date().toISOString(),
  };
  switch (system) {
    case 'kra':
      return { ...envelope, system, taxpayers: [] };
    case 'ntsa':
      return { ...envelope, system, vehicles: [] };
    case 'brs':
      return { ...envelope, system, directorships: [] };
    case 'ardhisasa':
      return { ...envelope, system, parcels: [] };
    case 'iprs':
      return { ...envelope, system, person: null };
  }
}

/** The registry did not answer in time (the gateway's breaker or timeout). */
export function unavailable(system: RegistrySystem): RegistryResult {
  return { ...notFound(system), outcome: 'unavailable', reason: 'timeout' };
}
