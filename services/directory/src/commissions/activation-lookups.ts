import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { InjectValkey } from '@adili/cache';

/** How long a subject with no invitation waiting is spared the database lookup (spec 01: 5 min). */
export const NOT_INVITED_TTL_SECONDS = 5 * 60;

/**
 * What the cache knows about a subject: recently found with no invitation waiting, or not known
 * so, with the version of the entry that was read. The version is handed back to
 * `rememberNotInvited`, so that an invitation made in the meantime is not overwritten.
 */
export type ActivationLookup = { notInvited: true } | { notInvited: false; version: string | null };

/**
 * Remembers, for a short while, which subjects have no `invited` reporting-officer assignment or
 * law-enforcement officer account, so that observing activations costs almost nothing for
 * everyone else. A cache only: it never throws, and a failure reads as "unknown" so the caller
 * falls back to the database.
 */
export abstract class ActivationLookups {
  abstract lookup(subject: string): Promise<ActivationLookup>;

  /**
   * Remembers that `subject` has no invitation waiting, unless the entry changed since it was
   * read as `version`: an invitation that committed while the database was being read must not
   * be hidden by the stale result.
   */
  abstract rememberNotInvited(subject: string, version: string | null): Promise<void>;

  /** Call once `subject` has been invited, so their next request is looked up again. */
  abstract forget(subject: string): Promise<void>;
}

/** The Valkey commands the adapter uses. */
export interface ValkeyCommands {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

const NOT_INVITED = 'not-invited';

/** Sets KEYS[1] to ARGV[2] for ARGV[3] seconds if it still holds ARGV[1] ('' for no value). */
const SET_IF_UNCHANGED = `
local current = redis.call('GET', KEYS[1])
if (current == false and ARGV[1] == '') or current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
end
return 0`;

/**
 * Valkey adapter: one key per subject, expiring after {@link NOT_INVITED_TTL_SECONDS}. It holds
 * `not-invited`, or a fresh invitation marker written by `forget`, which no stale lookup can
 * replace.
 */
@Injectable()
export class ValkeyActivationLookups extends ActivationLookups {
  private readonly logger = new Logger(ValkeyActivationLookups.name);

  constructor(@InjectValkey() private readonly valkey: ValkeyCommands) {
    super();
  }

  async lookup(subject: string): Promise<ActivationLookup> {
    try {
      const value = await this.valkey.get(key(subject));
      return value === NOT_INVITED ? { notInvited: true } : { notInvited: false, version: value };
    } catch (error) {
      this.logger.warn({ err: error }, 'Activation lookup cache unavailable; reading the database');
      // Unknown version: nothing is remembered afterwards, so the next request reads again.
      return { notInvited: false, version: randomUUID() };
    }
  }

  async rememberNotInvited(subject: string, version: string | null): Promise<void> {
    try {
      await this.valkey.eval(
        SET_IF_UNCHANGED,
        1,
        key(subject),
        version ?? '',
        NOT_INVITED,
        NOT_INVITED_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'Activation lookup cache unavailable; not remembered');
    }
  }

  async forget(subject: string): Promise<void> {
    try {
      await this.valkey.set(key(subject), `invited:${randomUUID()}`, 'EX', NOT_INVITED_TTL_SECONDS);
    } catch (error) {
      // The stale entry expires by itself; the officer's activation shows up at most a TTL late.
      this.logger.warn({ err: error }, 'Activation lookup cache unavailable; entry not forgotten');
    }
  }
}

function key(subject: string): string {
  return `activation:not-invited:${subject}`;
}

/** In-memory adapter for API tests, with the same semantics. `expireAll()` stands in for the TTL passing. */
export class InMemoryActivationLookups extends ActivationLookups {
  private readonly entries = new Map<string, string>();

  lookup(subject: string): Promise<ActivationLookup> {
    const value = this.entries.get(subject) ?? null;
    return Promise.resolve(
      value === NOT_INVITED ? { notInvited: true } : { notInvited: false, version: value },
    );
  }

  rememberNotInvited(subject: string, version: string | null): Promise<void> {
    if ((this.entries.get(subject) ?? null) === version) this.entries.set(subject, NOT_INVITED);
    return Promise.resolve();
  }

  forget(subject: string): Promise<void> {
    this.entries.set(subject, `invited:${randomUUID()}`);
    return Promise.resolve();
  }

  /** True when `subject` is remembered as having no invitation waiting. */
  knownNotInvited(subject: string): boolean {
    return this.entries.get(subject) === NOT_INVITED;
  }

  expireAll(): void {
    this.entries.clear();
  }
}
