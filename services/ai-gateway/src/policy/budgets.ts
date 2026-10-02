import { Inject, Injectable } from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, count, eq, gte, inArray, isNotNull, lt, or, sql, sum } from 'drizzle-orm';
import { z } from 'zod';

import { budgetInput } from '../admin/admin-input.js';
import { budgets, jobs, type schema } from '../db/schema.js';
import { LIVE_STATUSES } from '../jobs/job-states.js';
import { auditChange } from './audit.js';

export const BUDGET_DEFAULTS = Symbol('BUDGET_DEFAULTS');

/** Contract `BudgetInput`; also the limits of a tenant without a budget of its own. */
export interface BudgetLimits {
  /** Tokens (in and out) per calendar month, Africa/Nairobi. */
  monthlyTokens: number;
  /** Jobs created per minute. */
  perMinute: number;
}

const monthSchema = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}$/)
  .meta({ description: 'Calendar month, Africa/Nairobi' });

/** Contract `TenantUsage`. */
export const tenantUsageSchema = z.object({
  tenant: z.string(),
  month: monthSchema,
  monthlyTokens: z.number().int(),
  perMinute: z.number().int(),
  tokensUsed: z.number().int(),
  costMicros: z.number().int().meta({
    description: 'Estimated cost in micro US dollars (USD 1 = 1,000,000) at provider list price',
  }),
  jobs: z.number().int(),
  blocked: z.number().int(),
  failed: z.number().int(),
});
export type TenantUsage = z.infer<typeof tenantUsageSchema>;

/** Contract `UsageList`. */
export const usageListSchema = z.object({
  month: monthSchema,
  /** The budget of a tenant without one of its own. */
  defaults: budgetInput,
  tenants: z
    .array(tenantUsageSchema)
    .meta({ description: 'Tenants with a budget of their own or a job this month, by tenant' }),
});
export type UsageList = z.infer<typeof usageListSchema>;

const NO_USAGE = { tokensUsed: 0, costMicros: 0, jobs: 0, blocked: 0, failed: 0 } as const;

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
   * Whether the tenant has had its per-minute allowance of jobs admitted in the last 60 seconds;
   * when it has, the seconds until the oldest of them leaves the window. Only admitted jobs
   * count (queued or running, or started at some point): one blocked by the gate or the budget,
   * or failed at once because its provider is unreachable, loaded nothing. Concurrent requests
   * may each see room for one more: the limit bounds load, it is not an exact quota.
   */
  async rateLimited(
    tenant: string,
  ): Promise<{ limited: false } | { limited: true; retryAfterSeconds: number }> {
    const { perMinute } = await this.limits(tenant);
    const recent = await this.db
      .select({ createdAt: jobs.createdAt })
      .from(jobs)
      .where(
        and(
          eq(jobs.tenant, tenant),
          gte(jobs.createdAt, sql`now() - interval '1 minute'`),
          or(inArray(jobs.status, LIVE_STATUSES), isNotNull(jobs.startedAt)),
        ),
      )
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
    const [limits, [totals]] = await Promise.all([this.limits(tenant), this.totals(month, tenant)]);
    return { tenant, month, ...limits, ...(totals ?? NO_USAGE) };
  }

  /**
   * Usage in `month` of every tenant with a budget of its own or a job in the month, by tenant,
   * and the default budget of every other tenant (which has then used nothing).
   */
  async list(month: string = currentMonth()): Promise<UsageList> {
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          tenant: budgets.tenant,
          monthlyTokens: budgets.monthlyTokens,
          perMinute: budgets.perMinute,
        })
        .from(budgets),
      this.totals(month),
    ]);
    const limitsOf = new Map(rows.map(({ tenant, ...limits }) => [tenant, limits]));
    const usedBy = new Map(totals.map(({ tenant, ...used }) => [tenant, used]));
    const tenants = [...new Set([...limitsOf.keys(), ...usedBy.keys()])].sort();
    return {
      month,
      defaults: this.defaults,
      tenants: tenants.map((tenant) => ({
        tenant,
        month,
        ...(limitsOf.get(tenant) ?? this.defaults),
        ...(usedBy.get(tenant) ?? NO_USAGE),
      })),
    };
  }

  /** Tokens, cost and outcomes of jobs created in `month`, per tenant (or of one tenant). */
  private totals(month: string, tenant?: string) {
    return this.db
      .select({
        tenant: jobs.tenant,
        tokensUsed: sql`coalesce(sum(${jobs.tokensIn} + ${jobs.tokensOut}), 0)`.mapWith(Number),
        costMicros: sql`coalesce(sum(${jobs.costMicros}), 0)`.mapWith(Number),
        jobs: count(),
        blocked: count(sql`case when ${jobs.status} = 'blocked' then 1 end`),
        failed: count(sql`case when ${jobs.status} = 'failed' then 1 end`),
      })
      .from(jobs)
      .where(inMonth(month, tenant))
      .groupBy(jobs.tenant);
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
      .where(inMonth(month, tenant));
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

/** Jobs created in `month`, Nairobi time: the tenant's, or every tenant's. */
function inMonth(month: string, tenant?: string) {
  const match = MONTH.exec(month);
  if (!match) throw new Error(`Not a month: ${month}`);
  const start = `${month}-01 00:00:00`;
  return and(
    tenant === undefined ? undefined : eq(jobs.tenant, tenant),
    gte(jobs.createdAt, sql`(${start}::timestamp at time zone ${TIME_ZONE})`),
    lt(jobs.createdAt, sql`((${start}::timestamp + interval '1 month') at time zone ${TIME_ZONE})`),
  );
}
