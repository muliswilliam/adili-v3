import { Inject, Injectable } from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
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
import { type schema, type System, SYSTEMS, verificationResults } from '../db/schema.js';
import { systemSchema } from '../registries/registry-records.js';

export const systemCoverageSchema = z
  .object({
    system: systemSchema,
    /** Lookups in the last 24 hours, answered or not, cached or not. */
    calls24h: z.int().nonnegative(),
    cacheHitRate: z.number().min(0).max(1).meta({
      description:
        'Share of the last 24 hours of answers (found or not found) served from the cache; 0 without answers',
    }),
    /** Calls in the last 24 hours the registry failed: timed out or answered with an error. */
    failures24h: z.int().nonnegative(),
    breaker: z.enum(BREAKER_STATES).meta({
      description:
        'The circuit as the answering instance sees it; open past its cool-down reads half-open',
    }),
    /** When the registry itself last answered (found or not found); null if it never has. */
    lastSuccessAt: z.iso.datetime({ offset: true }).nullable(),
    paused: z.boolean(),
    rateLimitPerMinute: z.int().positive(),
    cacheTtlSeconds: z.int().positive(),
    timeoutMs: z.int().positive(),
    /** Consecutive failures that open the circuit. */
    breakerFailureThreshold: z.int().positive(),
    /** How long an open circuit fails fast before a probe. */
    breakerCooldownSeconds: z.number().positive(),
  })
  .meta({ description: 'How one registry integration is behaving' });
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
 * lookup, indexed by system and time); breaker state is this instance's.
 */
@Injectable()
export class Coverage {
  constructor(
    @InjectDatabase() private readonly db: Database<typeof schema>,
    private readonly breakers: CircuitBreakers,
    private readonly pauses: PauseFlags,
    @Inject(SYSTEM_POLICIES) private readonly policies: SystemPolicies,
    @Inject(BREAKER_OPTIONS) private readonly breakerOptions: BreakerOptions,
  ) {}

  async read(): Promise<SystemCoverage[]> {
    const systems = SYSTEMS.filter((system) => this.policies[system] !== undefined);
    const v = verificationResults;
    const counts = await this.db.execute<Counts>(sql`
      select ${v.system} as system,
        count(*)::int as calls,
        (count(*) filter (where ${v.cached}))::int as hits,
        (count(*) filter (where ${v.outcome} <> 'unavailable'))::int as answers,
        (count(*) filter (where ${v.reason} in ('timeout', 'upstream-error')))::int as failures
      from ${v}
      where ${v.checkedAt} > now() - interval '24 hours'
      group by ${v.system}`);
    const bySystem = new Map(counts.rows.map((row) => [row.system, row]));

    return Promise.all(
      systems.map(async (system): Promise<SystemCoverage> => {
        const policy = this.policies[system];
        if (!policy) throw new Error(`No policy configured for ${system}`);
        const count = bySystem.get(system);
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
          rateLimitPerMinute: policy.ratePerMinute,
          cacheTtlSeconds: policy.cacheTtlSeconds,
          timeoutMs: policy.timeoutMs,
          breakerFailureThreshold: this.breakerOptions.failureThreshold,
          breakerCooldownSeconds: this.breakerOptions.cooldownMs / 1000,
        };
      }),
    );
  }

  /** The newest answer from the registry itself, walking the (system, checked_at) index back. */
  private async lastSuccess(system: System): Promise<string | null> {
    const v = verificationResults;
    const rows = await this.db.execute<{ checkedAt: Date | string }>(sql`
      select ${v.checkedAt} as "checkedAt" from ${v}
      where ${v.system} = ${system} and ${v.outcome} <> 'unavailable' and not ${v.cached}
      order by ${v.checkedAt} desc
      limit 1`);
    const checkedAt = rows.rows[0]?.checkedAt;
    return checkedAt === undefined ? null : new Date(checkedAt).toISOString();
  }
}
