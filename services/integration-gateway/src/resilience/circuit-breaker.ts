import type { Clock } from './clock.js';

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Consecutive failures that open the circuit. */
  failureThreshold: number;
  /** How long the circuit stays open before one probe may pass. */
  cooldownMs: number;
}

/** The circuit is open: the call was not attempted. */
export class BreakerOpenError extends Error {
  override readonly name = 'BreakerOpenError';

  constructor() {
    super('circuit open; call not attempted');
  }
}

/**
 * Stops calling a failing upstream so callers get a fast answer instead of waiting out timeouts.
 * Closed: calls pass and consecutive failures are counted. Open: calls fail with
 * `BreakerOpenError` until the cool-down ends. Half-open: exactly one probe passes; success
 * closes the circuit, failure opens it for another cool-down.
 *
 * State is per process. Each instance learns about an outage from its own failures, which costs
 * at most `failureThreshold` slow calls per instance and needs no shared store.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private probing = false;

  constructor(
    private readonly options: CircuitBreakerOptions,
    private readonly clock: Clock,
  ) {}

  get state(): BreakerState {
    if (this.openedAt === null) return 'closed';
    return this.clock.now() - this.openedAt >= this.options.cooldownMs ? 'half-open' : 'open';
  }

  async run<T>(call: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === 'open' || (state === 'half-open' && this.probing)) {
      throw new BreakerOpenError();
    }
    const probe = state === 'half-open';
    if (probe) this.probing = true;
    try {
      const result = await call();
      this.failures = 0;
      this.openedAt = null;
      return result;
    } catch (error) {
      this.failures += 1;
      if (probe || this.failures >= this.options.failureThreshold) {
        this.openedAt = this.clock.now();
      }
      throw error;
    } finally {
      if (probe) this.probing = false;
    }
  }
}
