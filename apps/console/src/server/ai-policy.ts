import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { aiGatewayClient, type AiGatewayClient } from './ai-gateway/client.server';
import { isCommissionTask, TASK_NAMES } from './ai-gateway/tasks';
import type { Route, TenantPolicy, TenantUsage } from './ai-gateway/types';
import {
  type AiPolicyOverview,
  deleteRoute,
  loadAiPolicyOverview,
  saveGatePolicy,
  saveRoute,
  saveTenantBudget,
} from './ai-policy.server';
import { getBff } from './bff.server';
import { commissionSlug } from './commission-slug';
import { createDirectoryClient } from './directory/client';
import { env } from './env.server';
import type { ServiceResult } from './service-call';

/**
 * Server functions for the AI policy page (spec 07c FE-4), called as the signed-in platform
 * admin: the gateway refuses anyone else (403). Tokens stay on the server.
 */

/**
 * Runs `work` with an ai-gateway client acting as the signed-in user, or answers
 * `unauthenticated`. It checks no role: the gateway admits platform admins only and answers 403
 * to anyone else, which the page shows as no access.
 */
async function withAiGateway<T>(
  work: (gateway: AiGatewayClient, accessToken: string) => Promise<T>,
): Promise<T | { ok: false; error: { kind: 'unauthenticated' } }> {
  const session = await getBff().getSession(getRequest());
  if (!session) return { ok: false, error: { kind: 'unauthenticated' } };
  return work(aiGatewayClient(session.accessToken), session.accessToken);
}

export const getAiPolicyOverview = createServerFn({ method: 'GET' }).handler(
  (): Promise<ServiceResult<AiPolicyOverview>> =>
    withAiGateway((gateway, accessToken) =>
      loadAiPolicyOverview(
        gateway,
        createDirectoryClient({ baseUrl: env().DIRECTORY_API_URL, accessToken }),
      ),
    ),
);

const dataClass = z.enum(['synthetic', 'restricted', 'highly-confidential']);
const providerClass = z.enum(['external', 'self-hosted']);

export const setGatePolicyInput = z.object({
  tenant: commissionSlug,
  changes: z
    .array(z.object({ dataClass, providerClass, allowed: z.boolean() }))
    .min(1)
    .max(6),
  // Bounds as the contract has them; the gateway validates and its 400 maps back to the field.
  approvalRef: z.string().max(200),
});

/** Allows or blocks provider classes per data class: every change or none, audited. */
export const setGatePolicy = createServerFn({ method: 'POST' })
  .validator(setGatePolicyInput)
  .handler(({ data }): Promise<ServiceResult<TenantPolicy>> =>
    withAiGateway((gateway) =>
      saveGatePolicy(gateway, data.tenant, data.changes, data.approvalRef),
    ),
  );

export const setTenantBudgetInput = z.object({
  tenant: commissionSlug,
  // Bounds as the contract's BudgetInput has them.
  monthlyTokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  perMinute: z.number().int().min(1).max(2_147_483_647),
});

/** Sets a Commission's monthly token budget and per-minute limit. */
export const setTenantBudget = createServerFn({ method: 'POST' })
  .validator(setTenantBudgetInput)
  .handler(({ data }): Promise<ServiceResult<TenantUsage>> =>
    withAiGateway((gateway) =>
      saveTenantBudget(gateway, data.tenant, {
        monthlyTokens: data.monthlyTokens,
        perMinute: data.perMinute,
      }),
    ),
  );

const taskName = z.enum(TASK_NAMES);
// Bounds as the contract has them; the gateway validates and its 400 maps back to the field.
const approvalRef = z.string().max(200);

export const setRouteInput = z
  .object({
    /** Null: the route of every Commission without its own. */
    tenant: commissionSlug.nullable(),
    task: taskName,
    provider: z.string().max(100),
    model: z.string().max(200),
    params: z.object({
      maxOutputTokens: z.number().int().positive().optional(),
      effort: z.enum(['low', 'medium', 'high']).optional(),
      timeoutMs: z.number().int().positive().optional(),
    }),
    approvalRef,
  })
  // A Commission's own route is for a task it calls; an EACC task has only a default route, as the
  // gateway also enforces.
  .refine(({ tenant, task }) => tenant === null || isCommissionTask(task), {
    path: ['task'],
    message: 'Must be a task a Commission calls',
  });

/** Routes a task's calls for every Commission or for one, audited. */
export const setRoute = createServerFn({ method: 'POST' })
  .validator(setRouteInput)
  .handler(({ data }): Promise<ServiceResult<Route>> =>
    withAiGateway((gateway) =>
      saveRoute(gateway, data.tenant, data.task, {
        provider: data.provider,
        model: data.model,
        params: data.params,
        approvalRef: data.approvalRef,
      }),
    ),
  );

export const removeRouteInput = z.object({
  /** Null: the default route, so the task is back on the configured provider and model. */
  tenant: commissionSlug.nullable(),
  task: taskName,
  approvalRef,
});

/**
 * Removes a Commission's own route of a task (it follows every Commission's again) or a task's
 * default route (back to the configured provider and model), audited.
 */
export const removeRoute = createServerFn({ method: 'POST' })
  .validator(removeRouteInput)
  .handler(({ data }): Promise<ServiceResult<null>> =>
    withAiGateway((gateway) => deleteRoute(gateway, data.tenant, data.task, data.approvalRef)),
  );
