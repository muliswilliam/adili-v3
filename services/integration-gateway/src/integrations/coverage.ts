import { Inject, Injectable } from '@nestjs/common';
import { PLATFORM_TENANT } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  BREAKER_OPTIONS,
  BREAKER_STATES,
  type BreakerOptions,
  CircuitBreakers,
} from '../adapter-kit/circuit-breakers.js';
import { PauseFlags } from '../adapter-kit/pause-flags.js';
import { SYSTEM_POLICIES, type SystemPolicies } from '../adapter-kit/system-policies.js';
import {
  type schema,
  type System,
  systemCalls,
  SYSTEMS,
  verificationResults,
} from '../db/schema.js';
import { systemSchema } from '../registries/registry-records.js';
import { IntegrationSettings } from './integration-settings.js';

export const systemCoverageSchema = z
  .object({
    system: systemSchema,
    /**
     * Lookups (or, for payroll and ICMS, instructions and referrals sent) in the last 24 hours,
     * answered or not, cached or not.
     */
    calls24h: z.int().nonnegative(),
    cacheHitRate: z.number().min(0).max(1).meta({
      description:
        'Share of the last 24 hours of answers (found or not found) served from the cache; 0 without answers, and always 0 for a system that is never cached',
    }),
    /** Calls in the last 24 hours the registry failed: timed out or answered with an error. */
    failures24h: z.int().nonnegative(),
    breaker: z.enum(BREAKER_STATES).meta({
      description:
        'The circuit as the answering instance sees it; open past its cool-down reads half-open',
    }),
    /** When the system itself last answered (found or not found, or acknowledged); null if it never has. */
    lastSuccessAt: z.iso.datetime({ offset: true }).nullable(),
    paused: z.boolean(),
    pausedBy: z.string().nullable().meta({
      description: 'Display name of the platform administrator who paused it; null unless paused',
    }),
    pausedAt: z.iso
      .datetime({ offset: true })
      .nullable()
      .meta({ description: 'When it was paused; null unless paused' }),
    rateLimitPerMinute: z.int().positive(),
    cacheTtlSeconds: z.int().positive().nullable().meta({
      description:
        'How long an answer is reused; null for a system that is never cached (payroll instructions, ICMS referrals)',
    }),
    timeoutMs: z.int().positive(),
    /** Consecutive failures that open the circuit. */
    breakerFailureThreshold: z.int().positive(),
    /** How long an open circuit fails fast before a probe. */
    breakerCooldownSeconds: z.number().positive(),
  })
  .meta({ description: 'How one integration is behaving' });
export type SystemCoverage = z.infer<typeof systemCoverageSchema>;

export const coverageSchema = z
  .array(systemCoverageSchema)
  .meta({ description: 'Every system with an adapter, in a fixed order' });

interface Counts extends Record<string, unknown> {
  system: System;
  calls: number;
  hits: number;
  answers: number;
  failures: number;
}

/**
 * Per-system call volume, cache hit rate, failures, last success, breaker and pause state, for
 * platform administrators (spec 07b S13). Volumes come from verification results (one row per
 * lookup) and, for systems that are not looked up (payroll, ICMS), system calls (one row per call),
 * both indexed by system and time; breaker state is this instance's.
 */
@Injectable()
export class Coverage {
  constructor(
    @InjectDatabase() private readonly db: Database<typeof schema>,
    private readonly breakers: CircuitBreakers,
    private readonly pauses: PauseFlags,
    private readonly settings: IntegrationSettings,
    @Inject(SYSTEM_POLICIES) private readonly policies: SystemPolicies,
    @Inject(BREAKER_OPTIONS) private readonly breakerOptions: BreakerOptions,
  ) {}

  /** Whether `system` has an adapter: the systems coverage lists, and the ones a pause applies to. */
  covers(system: System): boolean {
    return this.policies[system] !== undefined;
  }

  /** One system's coverage. */
  async readOne(system: System): Promise<SystemCoverage> {
    const row = (await this.read()).find((entry) => entry.system === system);
    if (!row) throw new Error(`No coverage for ${system}`);
    return row;
  }

  async read(): Promise<SystemCoverage[]> {
    const systems = SYSTEMS.filter((system) => this.covers(system));
    const v = verificationResults;
    const c = systemCalls;
    const counts = await asPlatform(this.db, (tx) =>
      tx.execute<Counts>(sql`
      select system,
        count(*)::int as calls,
        (count(*) filter (where cached))::int as hits,
        (count(*) filter (where answered))::int as answers,
        (count(*) filter (where reason in ('timeout', 'upstream-error')))::int as failures
      from (
        select ${v.system} as system, ${v.cached} as cached,
          ${v.outcome} <> 'unavailable' as answered, ${v.reason} as reason
        from ${v}
        where ${v.checkedAt} > now() - interval '24 hours'
        union all
        select ${c.system}, false, ${c.outcome} = 'answered', ${c.reason}
        from ${c}
        where ${c.calledAt} > now() - interval '24 hours'
      ) as calls
      group by system`),
    );
    const bySystem = new Map(counts.rows.map((row) => [row.system, row]));
    const pauseRecords = await this.settings.pauseRecords();

    return Promise.all(
      systems.map(async (system): Promise<SystemCoverage> => {
        const policy = this.policies[system];
        if (!policy) throw new Error(`No policy configured for ${system}`);
        const count = bySystem.get(system);
        const record = pauseRecords.get(system);
        const [lastSuccessAt, paused] = await Promise.all([
          this.lastSuccess(system),
          this.pauses.isPaused(system),
        ]);
        return {
          system,
          calls24h: count?.calls ?? 0,
          cacheHitRate: count && count.answers > 0 ? count.hits / count.answers : 0,
          failures24h: count?.failures ?? 0,
          breaker: this.breakers.stateOf(system),
          lastSuccessAt,
          paused,
          // The lookups read the flag; who paused it is the record's (none for a stray flag).
          pausedBy: paused ? (record?.pausedBy ?? null) : null,
          pausedAt: paused ? (record?.pausedAt ?? null) : null,
          rateLimitPerMinute: policy.ratePerMinute,
          cacheTtlSeconds: policy.cacheTtlSeconds,
          timeoutMs: policy.timeoutMs,
          breakerFailureThreshold: this.breakerOptions.failureThreshold,
          breakerCooldownSeconds: this.breakerOptions.cooldownMs / 1000,
        };
      }),
    );
  }

  /**
   * The newest answer from the system itself: a lookup it answered (walking the
   * (system, checked_at) index back), or a call it answered (the (system, called_at) index).
   */
  private async lastSuccess(system: System): Promise<string | null> {
    const v = verificationResults;
    const c = systemCalls;
    const rows = await asPlatform(this.db, (tx) =>
      tx.execute<{ at: Date | string | null }>(sql`
      select greatest(
        (select ${v.checkedAt} from ${v}
          where ${v.system} = ${system} and ${v.outcome} <> 'unavailable' and not ${v.cached}
          order by ${v.checkedAt} desc limit 1),
        (select ${c.calledAt} from ${c}
          where ${c.system} = ${system} and ${c.outcome} = 'answered'
          order by ${c.calledAt} desc limit 1)
      ) as at`),
    );
    const at = rows.rows[0]?.at;
    return at === undefined || at === null ? null : new Date(at).toISOString();
  }
}

/** Coverage counts every tenant's lookups: the platform's context under row-level security. */
function asPlatform<T>(
  db: Database<typeof schema>,
  work: Parameters<typeof withTenant<typeof schema, T>>[2],
): Promise<T> {
  return withTenant(db, { tenant: PLATFORM_TENANT, subject: 'system:integration-gateway' }, work);
}
