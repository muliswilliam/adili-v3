import type { AiGatewayClient } from './ai-gateway/client.server';
import type {
  BudgetInput,
  GatePolicyInput,
  GateRule,
  Route,
  TenantPolicy,
  TenantUsage,
} from './ai-gateway/types';
import { callDirectory, type DirectoryClient } from './directory/client';
import { callService, type ServiceResult } from './service-call';

/**
 * The AI policy page's reads and writes against the ai-gateway (spec 07c FE-4, S16), folded into
 * results the page can switch on. Pure: the caller injects the clients (see `ai-policy.ts` for
 * the server functions that call these as the signed-in platform admin).
 */

/** One Commission on the AI policy page: its name from the directory, its gate and usage. */
export interface AiTenantRow {
  slug: string;
  name: string;
  rules: GateRule[];
  /** This month's usage and budget; null when the gateway did not answer for this tenant. */
  usage: TenantUsage | null;
}

/** A route with its parameters as plain values, so it crosses to the browser as it is. */
export type RouteRow = Omit<Route, 'params'> & {
  params: Record<string, string | number | boolean | null>;
};

export interface AiPolicyOverview {
  /** Every Commission in the directory, in its order (by name). */
  tenants: AiTenantRow[];
  /** The routing table; a failure here leaves the Commissions tab working. */
  routing: ServiceResult<RouteRow[]>;
}

/** Parameters are open-ended in the contract: keep plain values, write anything else as JSON. */
function plainParams(params: Route['params']): RouteRow['params'] {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      value === null || ['string', 'number', 'boolean'].includes(typeof value)
        ? (value as string | number | boolean | null)
        : JSON.stringify(value),
    ]),
  );
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

/**
 * The Commissions with their classification gate and this month's usage, and the routing table:
 * the directory's Commissions, `GET /v1/ai/policies`, `GET /v1/ai/routing`, then
 * `GET /v1/ai/tenants/{tenant}/usage` per Commission (the contract has no list of usage). A
 * Commission without a policy is blocked for every data class, the gateway's default.
 */
export async function loadAiPolicyOverview(
  gateway: AiGatewayClient,
  directory: DirectoryClient,
): Promise<ServiceResult<AiPolicyOverview>> {
  const [commissions, policies, routing] = await Promise.all([
    allCommissions(directory),
    callService(() => gateway.GET('/v1/ai/policies')),
    callService(() => gateway.GET('/v1/ai/routing')),
  ]);
  if (!policies.ok) return policies;
  if (!commissions.ok) return commissions;
  const rulesOf = new Map(policies.data.map((policy) => [policy.tenant, policy.rules]));
  const usage = await Promise.all(
    commissions.data.map(({ slug }) => loadTenantUsage(gateway, slug)),
  );
  return {
    ok: true,
    data: {
      tenants: commissions.data.map(({ slug, name }, index) => {
        const read = usage[index];
        return {
          slug,
          name,
          rules: rulesOf.get(slug) ?? [],
          usage: read?.ok ? read.data : null,
        };
      }),
      routing: routing.ok
        ? {
            ok: true,
            data: routing.data.map((route) => ({ ...route, params: plainParams(route.params) })),
          }
        : routing,
    },
  };
}

/** `GET /v1/ai/tenants/{tenant}/usage`. */
export function loadTenantUsage(
  gateway: AiGatewayClient,
  tenant: string,
): Promise<ServiceResult<TenantUsage>> {
  return callService(() =>
    gateway.GET('/v1/ai/tenants/{tenant}/usage', { params: { path: { tenant } } }),
  );
}

/** One cell of the gate that the platform admin changed. */
export type GateChange = Omit<GatePolicyInput, 'approvalRef'>;

/** How far a policy save got: every change, or the first failure after `saved` of them. */
export type GatePolicySave =
  | { ok: true; data: TenantPolicy }
  | {
      ok: false;
      error: Exclude<ServiceResult<never>, { ok: true }>['error'];
      /** Changes stored before the failure; the page reloads to show them. */
      saved: number;
    };

/**
 * `PUT /v1/ai/policies/{tenant}` once per changed cell, in order, each with the same approval
 * reference (the contract takes one data class and provider class per call). Stops at the first
 * failure and says how many were stored.
 */
export async function saveGatePolicy(
  gateway: AiGatewayClient,
  tenant: string,
  changes: readonly GateChange[],
  approvalRef: string,
): Promise<GatePolicySave> {
  let latest: TenantPolicy | null = null;
  for (const [index, change] of changes.entries()) {
    const result = await callService(() =>
      gateway.PUT('/v1/ai/policies/{tenant}', {
        params: { path: { tenant } },
        body: { ...change, approvalRef },
      }),
    );
    if (!result.ok) return { ok: false, error: result.error, saved: index };
    latest = result.data;
  }
  return latest
    ? { ok: true, data: latest }
    : { ok: false, error: { kind: 'unavailable', detail: null }, saved: 0 };
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
