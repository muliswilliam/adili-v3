import { Inject, Injectable } from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, count, eq, gte, lt, sql, sum } from 'drizzle-orm';

import { budgets, jobs, type schema } from '../db/schema.js';
import { auditChange } from './audit.js';

export const BUDGET_DEFAULTS = Symbol('BUDGET_DEFAULTS');

/** Contract `BudgetInput`; also the limits of a tenant without a budget of its own. */
export interface BudgetLimits {
  /** Tokens (in and out) per calendar month, Africa/Nairobi. */
  monthlyTokens: number;
  /** Jobs created per minute. */
  perMinute: number;
}

/** Contract `TenantUsage`. */
export interface TenantUsage extends BudgetLimits {
  tenant: string;
  /** `YYYY-MM`, Africa/Nairobi. */
  month: string;
  tokensUsed: number;
  costMicros: number;
  jobs: number;
  blocked: number;
  failed: number;
}

/** Budgets run by the calendar month in Kenya, where the Commissions are. */
const TIME_ZONE = 'Africa/Nairobi';
const MONTH = /^(\d{4})-(\d{2})$/;

/**
 * Per-tenant token budgets and rate limits (spec 07c), and the usage they are measured against,
 * aggregated from the jobs table. Tokens count once a job has ended, so jobs still running can
 * take a tenant past its budget by their own size; the next job is then blocked.
 */
@Injectable()
export class Budgets {
  constructor(
    @InjectDatabase() private readonly db: Database<typeof schema>,
    private readonly events: EventPublisher,
    @Inject(BUDGET_DEFAULTS) private readonly defaults: BudgetLimits,
  ) {}

  async limits(tenant: string): Promise<BudgetLimits> {
    const [row] = await this.db
      .select({ monthlyTokens: budgets.monthlyTokens, perMinute: budgets.perMinute })
      .from(budgets)
      .where(eq(budgets.tenant, tenant));
    return row ?? this.defaults;
  }

  /** Whether the tenant has used its tokens for the current month. */
  async exhausted(tenant: string): Promise<boolean> {
    const [{ monthlyTokens }, used] = await Promise.all([
      this.limits(tenant),
      this.tokensUsed(tenant, currentMonth()),
    ]);
    return used >= monthlyTokens;
  }

  /**
   * Whether the tenant has created its per-minute allowance of jobs in the last 60 seconds;
   * when it has, the seconds until the oldest of them leaves the window. Concurrent requests
   * may each see room for one more: the limit bounds load, it is not an exact quota.
   */
  async rateLimited(
    tenant: string,
  ): Promise<{ limited: false } | { limited: true; retryAfterSeconds: number }> {
    const { perMinute } = await this.limits(tenant);
    const recent = await this.db
      .select({ createdAt: jobs.createdAt })
      .from(jobs)
      .where(and(eq(jobs.tenant, tenant), gte(jobs.createdAt, sql`now() - interval '1 minute'`)))
      .orderBy(jobs.createdAt)
      .limit(perMinute);
    if (recent.length < perMinute) return { limited: false };
    const oldest = recent[0]?.createdAt.getTime() ?? Date.now();
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + 60_000 - Date.now()) / 1000)),
    };
  }

  /** The tenant's budget and what its jobs used in `month` (`YYYY-MM`, default the current). */
  async usage(tenant: string, month: string = currentMonth()): Promise<TenantUsage> {
    const [limits, [totals]] = await Promise.all([
      this.limits(tenant),
      this.db
        .select({
          tokensUsed: sum(sql`${jobs.tokensIn} + ${jobs.tokensOut}`).mapWith(Number),
          costMicros: sum(jobs.costMicros).mapWith(Number),
          jobs: count(),
          blocked: count(sql`case when ${jobs.status} = 'blocked' then 1 end`),
          failed: count(sql`case when ${jobs.status} = 'failed' then 1 end`),
        })
        .from(jobs)
        .where(inMonth(tenant, month)),
    ]);
    return {
      tenant,
      month,
      ...limits,
      tokensUsed: totals?.tokensUsed ?? 0,
      costMicros: totals?.costMicros ?? 0,
      jobs: totals?.jobs ?? 0,
      blocked: totals?.blocked ?? 0,
      failed: totals?.failed ?? 0,
    };
  }

  /** Sets the tenant's budget; the change, its audit record and its event commit together. */
  async set(tenant: string, input: BudgetLimits, actor: string): Promise<TenantUsage> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ monthlyTokens: budgets.monthlyTokens, perMinute: budgets.perMinute })
        .from(budgets)
        .where(eq(budgets.tenant, tenant))
        .for('update');
      await tx
        .insert(budgets)
        .values({ tenant, ...input, changedBy: actor })
        .onConflictDoUpdate({
          target: budgets.tenant,
          set: { ...input, changedBy: actor, changedAt: sql`now()` },
        });
      const event = await auditChange(tx, {
        action: 'ai.budget.changed',
        tenant,
        actor,
        approvalRef: null,
        before: before ?? { ...this.defaults, default: true },
        after: input,
      });
      await this.events.record(tx, event);
    });
    return this.usage(tenant);
  }

  private async tokensUsed(tenant: string, month: string): Promise<number> {
    const [row] = await this.db
      .select({ used: sum(sql`${jobs.tokensIn} + ${jobs.tokensOut}`).mapWith(Number) })
      .from(jobs)
      .where(inMonth(tenant, month));
    return row?.used ?? 0;
  }
}

/** The current month, `YYYY-MM`, in Nairobi. */
export function currentMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((each) => each.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}`;
}

/** The tenant's jobs created in `month`, Nairobi time. */
function inMonth(tenant: string, month: string) {
  const match = MONTH.exec(month);
  if (!match) throw new Error(`Not a month: ${month}`);
  const start = `${month}-01 00:00:00`;
  return and(
    eq(jobs.tenant, tenant),
    gte(jobs.createdAt, sql`(${start}::timestamp at time zone ${TIME_ZONE})`),
    lt(jobs.createdAt, sql`((${start}::timestamp + interval '1 month') at time zone ${TIME_ZONE})`),
  );
}
