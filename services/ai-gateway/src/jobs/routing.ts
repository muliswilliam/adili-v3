import { Inject, Injectable } from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';

import { routes, type schema } from '../db/schema.js';
import type { ProviderClass } from '../providers/port.js';
import { ProviderRegistry } from '../providers/providers.module.js';
import { TASK_NAMES, type TaskName } from '../tasks/task.js';

export const ROUTING_OPTIONS = Symbol('ROUTING_OPTIONS');

export interface RoutingOptions {
  /** Model of every task without a routing row, on the configured provider. */
  model: string;
}

/** Parameters a routing row may set for its calls; unset ones fall back to the task's. */
export const routeParamsSchema = z.strictObject({
  maxOutputTokens: z.number().int().positive().optional(),
  effort: z.enum(['low', 'medium', 'high']).optional(),
  /** Longest one provider call may take; the provider client's own timeout still applies. */
  timeoutMs: z.number().int().positive().optional(),
});
export type RouteParams = z.infer<typeof routeParamsSchema>;

export interface Route {
  provider: string;
  model: string;
  params: RouteParams;
}

/** Contract `Route`: a row of the effective routing table. */
export interface RouteView extends Route {
  /** Null for the default route of every tenant. */
  tenant: string | null;
  task: TaskName;
  /** Null when this process cannot reach the provider. */
  providerClass: ProviderClass | null;
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
    @InjectDatabase() private readonly db: Database<typeof schema>,
    private readonly providers: ProviderRegistry,
    @Inject(ROUTING_OPTIONS) private readonly options: RoutingOptions,
  ) {}

  async route(tenant: string, task: TaskName): Promise<Route> {
    const rows = await this.db
      .select()
      .from(routes)
      .where(and(eq(routes.task, task), or(eq(routes.tenant, tenant), isNull(routes.tenant))));
    const row = rows.find((each) => each.tenant === tenant) ?? rows[0];
    return row
      ? { provider: row.provider, model: row.model, params: parseParams(row.params, row.id) }
      : this.fallback();
  }

  /** The effective table: every row, and the configured route for tasks without a default row. */
  async table(): Promise<RouteView[]> {
    const rows = await this.db.select().from(routes).orderBy(asc(routes.task), asc(routes.tenant));
    const defaults = new Set(rows.filter((row) => row.tenant === null).map((row) => row.task));
    const view = (tenant: string | null, task: TaskName, route: Route): RouteView => ({
      tenant,
      task,
      provider: route.provider,
      providerClass: this.providers.get(route.provider)?.providerClass ?? null,
      model: route.model,
      params: route.params,
    });
    return [
      ...rows.map((row) =>
        view(row.tenant, row.task, {
          provider: row.provider,
          model: row.model,
          params: parseParams(row.params, row.id),
        }),
      ),
      ...TASK_NAMES.filter((task) => !defaults.has(task)).map((task) =>
        view(null, task, this.fallback()),
      ),
    ];
  }

  private fallback(): Route {
    return { provider: this.providers.default.name, model: this.options.model, params: {} };
  }
}

/** Parameters stored on a routing row or a job; a malformed row is a configuration error. */
export function parseParams(params: unknown, source: string): RouteParams {
  const parsed = routeParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid routing parameters (${source}): ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
