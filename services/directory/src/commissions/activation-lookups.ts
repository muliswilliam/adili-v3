import { Injectable, Logger } from '@nestjs/common';
import { InjectValkey } from '@adili/cache';

/** How long a subject with no invitation waiting is spared the database lookup (spec 01: 5 min). */
export const NOT_INVITED_TTL_SECONDS = 5 * 60;

/**
 * Remembers, for a short while, which subjects have no `invited` reporting-officer assignment,
 * so that observing activations costs almost nothing for everyone else. A cache only: it never
 * throws, and a failure reads as "unknown" so the caller falls back to the database.
 */
export abstract class ActivationLookups {
  /** True when `subject` was recently found to have no invitation waiting. */
  abstract knownNotInvited(subject: string): Promise<boolean>;
  abstract rememberNotInvited(subject: string): Promise<void>;
  /** Call once `subject` has been invited, so their next request is looked up again. */
  abstract forget(subject: string): Promise<void>;
}

/** The Valkey commands the adapter uses. */
export interface ValkeyCommands {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(key: string): Promise<number>;
}

/** Valkey adapter: one key per subject, expiring after {@link NOT_INVITED_TTL_SECONDS}. */
@Injectable()
export class ValkeyActivationLookups extends ActivationLookups {
  private readonly logger = new Logger(ValkeyActivationLookups.name);

  constructor(@InjectValkey() private readonly valkey: ValkeyCommands) {
    super();
  }

  async knownNotInvited(subject: string): Promise<boolean> {
    try {
      return (await this.valkey.get(key(subject))) !== null;
    } catch (error) {
      this.logger.warn({ err: error }, 'Activation lookup cache unavailable; reading the database');
      return false;
    }
  }

  async rememberNotInvited(subject: string): Promise<void> {
    try {
      await this.valkey.set(key(subject), '1', 'EX', NOT_INVITED_TTL_SECONDS);
    } catch (error) {
      this.logger.warn({ err: error }, 'Activation lookup cache unavailable; not remembered');
    }
  }

  async forget(subject: string): Promise<void> {
    try {
      await this.valkey.del(key(subject));
    } catch (error) {
      // The stale entry expires by itself; the officer's activation shows up at most a TTL late.
      this.logger.warn({ err: error }, 'Activation lookup cache unavailable; entry not forgotten');
    }
  }
}

function key(subject: string): string {
  return `activation:not-invited:${subject}`;
}

/** In-memory adapter for API tests. `expireAll()` stands in for the TTL passing. */
export class InMemoryActivationLookups extends ActivationLookups {
  private readonly notInvited = new Set<string>();

  knownNotInvited(subject: string): Promise<boolean> {
    return Promise.resolve(this.notInvited.has(subject));
  }

  rememberNotInvited(subject: string): Promise<void> {
    this.notInvited.add(subject);
    return Promise.resolve();
  }

  forget(subject: string): Promise<void> {
    this.notInvited.delete(subject);
    return Promise.resolve();
  }

  expireAll(): void {
    this.notInvited.clear();
  }
}
