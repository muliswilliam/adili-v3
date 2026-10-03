import type { AiGatewayClient } from './ai-gateway/client.server';
import type {
  BudgetInput,
  DataClass,
  GateRule,
  GateRuleInput,
  ProviderClass,
  Route,
  RouteInput,
  TaskName,
  TenantPolicy,
  TenantUsage,
  UsageList,
} from './ai-gateway/types';
import { isReviewerTask } from './ai-gateway/tasks';
import { callDirectory, type DirectoryClient } from './directory/client';
import { callService, type ServiceResult } from './service-call';

/**
 * The AI policy page's reads and writes against the ai-gateway (spec 07c FE-4, S16), folded into
 * results the page can switch on. Pure: the caller injects the clients (see `ai-policy.ts` for
 * the server functions that call these as the signed-in platform admin).
 */

/** One cell of a Commission's gate: allowed or not, and the explicit rule behind it, if any. */
export interface GateCellView {
  dataClass: DataClass;
  providerClass: ProviderClass;
  /** For every task: a rule for some tasks only leaves the cell to the default. */
  allowed: boolean;
  /** Null when the gateway's default decides the cell. */
  rule: GateRule | null;
}

/** One Commission on the AI policy page: its name from the directory, its gate and usage. */
export interface AiTenantRow {
  slug: string;
  name: string;
  /** Every data class and provider class, in table order. */
  gate: GateCellView[];
  /** The provider classes the Commission's tasks are routed to (every class when unknown). */
  routed: ProviderClass[];
  /** This month's usage and budget; null when the gateway did not answer. */
  usage: TenantUsage | null;
}

/** A route with its parameters as a plain record, so the page lists any it does not know too. */
export type RouteRow = Omit<Route, 'params'> & {
  params: Record<string, string | number | boolean | null>;
};

export interface AiPolicyOverview {
  /** Every Commission in the directory, in its order (by name). */
  tenants: AiTenantRow[];
  /** The routing table; a failure here leaves the Commissions tab working. */
  routing: ServiceResult<RouteRow[]>;
}

/** Directory pages read at most, at the largest page size: 4,000 Commissions. */
const MAX_DIRECTORY_PAGES = 20;
const DIRECTORY_PAGE_SIZE = 200;

/** Every Commission in the directory, slug and name, following the cursor to the last page. */
async function allCommissions(
  directory: DirectoryClient,
): Promise<ServiceResult<{ slug: string; name: string }[]>> {
  const commissions: { slug: string; name: string }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_DIRECTORY_PAGES; page += 1) {
    const result = await callDirectory(() =>
      directory.GET('/v1/commissions', {
        params: { query: { limit: DIRECTORY_PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
      }),
    );
    if (!result.ok) return result;
    commissions.push(...result.data.items.map(({ slug, name }) => ({ slug, name })));
    if (!result.data.nextCursor) break;
    cursor = result.data.nextCursor;
  }
  return { ok: true, data: commissions };
}

/** The gate of every cell for a Commission: its own rule where it has one, else the default. */
export function gateOf(
  defaults: readonly GateRuleInput[],
  rules: readonly GateRule[],
): GateCellView[] {
  return defaults.map((cell) => {
    const rule =
      rules.find(
        (each) => each.dataClass === cell.dataClass && each.providerClass === cell.providerClass,
      ) ?? null;
    return {
      dataClass: cell.dataClass,
      providerClass: cell.providerClass,
      // A rule for some tasks only (the demo's document reading, spec 05b) decides for those
      // tasks alone: for the Commission's AI assistance the default still applies.
      allowed: rule?.tasks === null ? rule.allowed : cell.allowed,
      rule,
    };
  });
}

const PROVIDER_CLASSES: readonly ProviderClass[] = ['external', 'self-hosted'];

/**
 * The provider classes a Commission's reviewer tasks are routed to: per task its own route, else
 * the default route. Routes to a provider the gateway cannot reach send nothing anywhere.
 */
export function routedClasses(routes: readonly Route[], tenant: string): ProviderClass[] {
  const tasks = new Set(routes.map((route) => route.task).filter(isReviewerTask));
  const classes = new Set(
    [...tasks].flatMap((task) => {
      const route =
        routes.find((each) => each.task === task && each.tenant === tenant) ??
        routes.find((each) => each.task === task && each.tenant === null);
      return route?.providerClass ? [route.providerClass] : [];
    }),
  );
  return PROVIDER_CLASSES.filter((each) => classes.has(each));
}

/** A Commission's usage from the list: its own entry, else the default budget and nothing used. */
function usageOf(list: UsageList, tenant: string): TenantUsage {
  return (
    list.tenants.find((each) => each.tenant === tenant) ?? {
      tenant,
      month: list.month,
      ...list.defaults,
      tokensUsed: 0,
      costMicros: 0,
      jobs: 0,
      blocked: 0,
      failed: 0,
    }
  );
}

/**
 * The Commissions with their classification gate and this month's usage, and the routing table:
 * the directory's Commissions with `GET /v1/ai/policies`, `GET /v1/ai/routing` and
 * `GET /v1/ai/usage`. The gateway lists only the tenants it has rules or usage for; every other
 * Commission has the default gate and budget the lists carry.
 */
export async function loadAiPolicyOverview(
  gateway: AiGatewayClient,
  directory: DirectoryClient,
): Promise<ServiceResult<AiPolicyOverview>> {
  const [commissions, policies, routing, usage] = await Promise.all([
    allCommissions(directory),
    callService(() => gateway.GET('/v1/ai/policies')),
    callService(() => gateway.GET('/v1/ai/routing')),
    callService(() => gateway.GET('/v1/ai/usage')),
  ]);
  if (!policies.ok) return policies;
  if (!commissions.ok) return commissions;
  const rulesOf = new Map(policies.data.tenants.map((policy) => [policy.tenant, policy.rules]));
  return {
    ok: true,
    data: {
      tenants: commissions.data.map(({ slug, name }) => ({
        slug,
        name,
        gate: gateOf(policies.data.defaults, rulesOf.get(slug) ?? []),
        routed: routing.ok ? routedClasses(routing.data, slug) : [...PROVIDER_CLASSES],
        usage: usage.ok ? usageOf(usage.data, slug) : null,
      })),
      routing: routing.ok
        ? {
            ok: true,
            data: routing.data.map((route) => ({ ...route, params: { ...route.params } })),
          }
        : routing,
    },
  };
}

/** One cell of the gate that the platform admin changed. */
export type GateChange = GateRuleInput;

/**
 * `PUT /v1/ai/policies/{tenant}`: every changed cell on one approval reference. The gateway
 * stores all of them or none.
 */
export function saveGatePolicy(
  gateway: AiGatewayClient,
  tenant: string,
  changes: readonly GateChange[],
  approvalRef: string,
): Promise<ServiceResult<TenantPolicy>> {
  return callService(() =>
    gateway.PUT('/v1/ai/policies/{tenant}', {
      params: { path: { tenant } },
      body: { rules: [...changes], approvalRef },
    }),
  );
}

/** `PUT /v1/ai/tenants/{tenant}/usage`: the monthly token budget and the per-minute limit. */
export function saveTenantBudget(
  gateway: AiGatewayClient,
  tenant: string,
  budget: BudgetInput,
): Promise<ServiceResult<TenantUsage>> {
  return callService(() =>
    gateway.PUT('/v1/ai/tenants/{tenant}/usage', {
      params: { path: { tenant } },
      body: budget,
    }),
  );
}

/**
 * `PUT /v1/ai/routing/{task}` (tenant null: every Commission without its own route) or
 * `PUT /v1/ai/tenants/{tenant}/routing/{task}`: where the task's calls go, audited with the
 * approval reference. The next job follows it.
 */
export function saveRoute(
  gateway: AiGatewayClient,
  tenant: string | null,
  task: TaskName,
  route: RouteInput,
): Promise<ServiceResult<Route>> {
  return callService(() =>
    tenant === null
      ? gateway.PUT('/v1/ai/routing/{task}', { params: { path: { task } }, body: route })
      : gateway.PUT('/v1/ai/tenants/{tenant}/routing/{task}', {
          params: { path: { tenant, task } },
          body: route,
        }),
  );
}

/**
 * `DELETE /v1/ai/tenants/{tenant}/routing/{task}`: the Commission's own route goes, and the task
 * follows the route of every Commission again; or `DELETE /v1/ai/routing/{task}` (tenant null):
 * the default route goes, and the task is back on the gateway's configured provider and model.
 * Audited with the approval reference.
 */
export function deleteRoute(
  gateway: AiGatewayClient,
  tenant: string | null,
  task: TaskName,
  approvalRef: string,
): Promise<ServiceResult<null>> {
  // 204: no body, so nothing to read but the outcome.
  return callService(async () => ({
    ...(await (tenant === null
      ? gateway.DELETE('/v1/ai/routing/{task}', {
          params: { path: { task }, query: { approvalRef } },
        })
      : gateway.DELETE('/v1/ai/tenants/{tenant}/routing/{task}', {
          params: { path: { tenant, task }, query: { approvalRef } },
        }))),
    data: null,
  }));
}
