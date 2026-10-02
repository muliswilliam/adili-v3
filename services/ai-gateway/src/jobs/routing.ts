import { Inject, Injectable } from '@nestjs/common';
import { PLATFORM_TENANT } from '@adili/api-kit';
import { InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { v7 as uuidv7 } from 'uuid';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  asPlatform,
  asTenant,
  type GatewayDatabase,
  type GatewayTransaction,
} from '../db/context.js';
import { lockTenantSetting } from '../db/locks.js';
import { type RouteRow, routes } from '../db/schema.js';
import { auditChange } from '../policy/audit.js';
import { providerClassSchema } from '../providers/port.js';
import { ProviderRegistry } from '../providers/providers.module.js';
import { TASK_NAMES, type TaskName, taskNameSchema } from '../tasks/task.js';

export const ROUTING_OPTIONS = Symbol('ROUTING_OPTIONS');

export interface RoutingOptions {
  /** Model of every task without a routing row, on the configured provider. */
  model: string;
}

/** Parameters a routing row may set for its calls; unset ones fall back to the task's. */
export const routeParamsSchema = z
  .strictObject({
    maxOutputTokens: z.number().int().positive().optional(),
    effort: z.enum(['low', 'medium', 'high']).optional(),
    /** Longest one provider call may take; the provider client's own timeout still applies. */
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .meta({ description: 'Longest one provider call may take' }),
  })
  .meta({ description: "Call parameters; an unset one falls back to the task's own" });
export type RouteParams = z.infer<typeof routeParamsSchema>;

export interface Route {
  provider: string;
  model: string;
  params: RouteParams;
}

/** Contract `Route`: a row of the effective routing table. */
export const routeViewSchema = z.object({
  tenant: z.string().nullable().meta({ description: 'null is the default route' }),
  task: taskNameSchema,
  provider: z.string(),
  providerClass: providerClassSchema.nullable().meta({
    description:
      "The provider's class, which the gate decides on; null when this gateway cannot reach the provider (its jobs fail `provider-unavailable`)",
  }),
  model: z.string(),
  params: routeParamsSchema,
});
export type RouteView = z.infer<typeof routeViewSchema>;

/** Contract `RouteInput`: where a task's calls go, on which approval. */
export const routeInputSchema = z
  .strictObject({
    provider: z.string().trim().min(1).max(100).meta({
      description: 'A provider this gateway is configured to reach (`Route.provider` names them)',
    }),
    model: z.string().trim().min(1).max(200),
    params: routeParamsSchema.default({}),
    approvalRef: z.string().trim().min(1).max(200).meta({
      description: 'The decision the change rests on, e.g. an EACC approval number',
    }),
  })
  .meta({ description: "A task's route: provider, model and call parameters" });
export type RouteInput = z.infer<typeof routeInputSchema>;

/** A route change names a provider this gateway cannot reach. */
export class UnknownProviderError extends Error {
  override readonly name = 'UnknownProviderError';
}

/**
 * Decides provider, model and call parameters for a job; callers never do (spec 07c). The
 * routing table's row for the tenant and task wins, then its row for the task, then the
 * configured provider and model. Switching a task to another provider or model is a change to
 * the table, read at the next job, not to code.
 */
@Injectable()
export class Routing {
  constructor(
    @InjectDatabase() private readonly db: GatewayDatabase,
    private readonly providers: ProviderRegistry,
    private readonly events: EventPublisher,
    @Inject(ROUTING_OPTIONS) private readonly options: RoutingOptions,
  ) {}

  async route(tenant: string, task: TaskName): Promise<Route> {
    const rows = await asTenant(this.db, tenant, (tx) =>
      tx
        .select()
        .from(routes)
        .where(and(eq(routes.task, task), or(eq(routes.tenant, tenant), isNull(routes.tenant)))),
    );
    const row = rows.find((each) => each.tenant === tenant) ?? rows[0];
    return row ? routeOf(row) : this.fallback();
  }

  /** The effective table: every row, and the configured route for tasks without a default row. */
  async table(): Promise<RouteView[]> {
    const rows = await asPlatform(this.db, (tx) =>
      tx.select().from(routes).orderBy(asc(routes.task), asc(routes.tenant)),
    );
    const defaults = new Set(rows.filter((row) => row.tenant === null).map((row) => row.task));
    const view = (tenant: string | null, task: TaskName, route: Route) =>
      this.view(tenant, task, route);
    return [
      ...rows.map((row) => view(row.tenant, row.task, routeOf(row))),
      ...TASK_NAMES.filter((task) => !defaults.has(task)).map((task) =>
        view(null, task, this.fallback()),
      ),
    ];
  }

  /**
   * Routes `task` for `tenant` (null: the default route of every tenant without its own) to a
   * provider this gateway reaches, recording who decided and on which approval. The row, its
   * audit record and its `ai.policy.changed.v1` event (action `ai.route.changed`) commit
   * together; the next job follows it. Throws `UnknownProviderError` for any other provider.
   */
  async set(
    tenant: string | null,
    task: TaskName,
    input: RouteInput,
    actor: string,
  ): Promise<RouteView> {
    if (!this.providers.get(input.provider)) {
      throw new UnknownProviderError(`This gateway cannot reach provider ${input.provider}`);
    }
    const after: Route = { provider: input.provider, model: input.model, params: input.params };
    await this.change(tenant, task, actor, async (tx) => {
      const values = { ...after, changedBy: actor, changedAt: new Date() };
      await tx
        .insert(routes)
        .values({ id: uuidv7(), tenant, task, ...values })
        .onConflictDoUpdate(
          tenant === null
            ? { target: routes.task, targetWhere: isNull(routes.tenant), set: values }
            : {
                target: [routes.tenant, routes.task],
                targetWhere: sql`${routes.tenant} is not null`,
                set: values,
              },
        );
      return { after, approvalRef: input.approvalRef };
    });
    return this.view(tenant, task, after);
  }

  /**
   * Removes the route of `task` for `tenant` (null: the default route), audited like a change:
   * the task then follows the default route, or the configured provider and model. False when
   * there was no such route.
   */
  async remove(
    tenant: string | null,
    task: TaskName,
    approvalRef: string,
    actor: string,
  ): Promise<boolean> {
    let removed = false;
    await this.change(tenant, task, actor, async (tx) => {
      const deleted = await tx
        .delete(routes)
        .where(
          and(
            eq(routes.task, task),
            tenant === null ? isNull(routes.tenant) : eq(routes.tenant, tenant),
          ),
        )
        .returning({ id: routes.id });
      removed = deleted.length > 0;
      return removed ? { after: null, approvalRef } : undefined;
    });
    return removed;
  }

  /**
   * Runs a change of one route in turn with others of the same route, then audits and announces
   * what `write` reports changed (nothing when it reports undefined).
   */
  private async change(
    tenant: string | null,
    task: TaskName,
    actor: string,
    write: (
      tx: GatewayTransaction,
    ) => Promise<{ after: Route | null; approvalRef: string } | undefined>,
  ): Promise<void> {
    const work = async (tx: GatewayTransaction) => {
      await lockTenantSetting(tx, 'routing', `${tenant ?? PLATFORM_TENANT}:${task}`);
      const [row] = await tx
        .select()
        .from(routes)
        .where(
          and(
            eq(routes.task, task),
            tenant === null ? isNull(routes.tenant) : eq(routes.tenant, tenant),
          ),
        );
      const written = await write(tx);
      if (!written) return;
      const event = await auditChange(tx, {
        action: 'ai.route.changed',
        tenant: tenant ?? PLATFORM_TENANT,
        actor,
        approvalRef: written.approvalRef,
        before: { tenant, task, route: row ? routeOf(row) : null },
        after: { tenant, task, route: written.after },
      });
      await this.events.record(tx, event);
    };
    // A default route is every tenant's: only platform work writes it.
    await (tenant === null
      ? asPlatform(this.db, work, actor)
      : asTenant(this.db, tenant, work, actor));
  }

  private view(tenant: string | null, task: TaskName, route: Route): RouteView {
    return {
      tenant,
      task,
      provider: route.provider,
      providerClass: this.providers.get(route.provider)?.providerClass ?? null,
      model: route.model,
      params: route.params,
    };
  }

  private fallback(): Route {
    return { provider: this.providers.default.name, model: this.options.model, params: {} };
  }
}

function routeOf(row: RouteRow): Route {
  return { provider: row.provider, model: row.model, params: parseParams(row.params, row.id) };
}

/** Parameters stored on a routing row or a job; a malformed row is a configuration error. */
export function parseParams(params: unknown, source: string): RouteParams {
  const parsed = routeParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid routing parameters (${source}): ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
