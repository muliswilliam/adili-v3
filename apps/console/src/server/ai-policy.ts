import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { aiGatewayClient, type AiGatewayClient } from './ai-gateway/client.server';
import type { TenantUsage } from './ai-gateway/types';
import {
  type AiPolicyOverview,
  type GatePolicySave,
  loadAiPolicyOverview,
  saveGatePolicy,
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

async function asPlatformAdmin<T>(
  work: (gateway: AiGatewayClient, accessToken: string) => Promise<T>,
): Promise<T | { ok: false; error: { kind: 'unauthenticated' } }> {
  const session = await getBff().getSession(getRequest());
  if (!session) return { ok: false, error: { kind: 'unauthenticated' } };
  return work(aiGatewayClient(session.accessToken), session.accessToken);
}

export const getAiPolicyOverview = createServerFn({ method: 'GET' }).handler(
  (): Promise<ServiceResult<AiPolicyOverview>> =>
    asPlatformAdmin((gateway, accessToken) =>
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

/** Allows or blocks provider classes per data class, one audited call per changed cell. */
export const setGatePolicy = createServerFn({ method: 'POST' })
  .validator(setGatePolicyInput)
  .handler(({ data }): Promise<GatePolicySave> =>
    asPlatformAdmin((gateway) =>
      saveGatePolicy(gateway, data.tenant, data.changes, data.approvalRef),
    ).then((result) => ('saved' in result || result.ok ? result : { ...result, saved: 0 })),
  );

export const setTenantBudgetInput = z.object({
  tenant: commissionSlug,
  monthlyTokens: z.number().int().min(0),
  perMinute: z.number().int().min(1),
});

/** Sets a Commission's monthly token budget and per-minute limit. */
export const setTenantBudget = createServerFn({ method: 'POST' })
  .validator(setTenantBudgetInput)
  .handler(({ data }): Promise<ServiceResult<TenantUsage>> =>
    asPlatformAdmin((gateway) =>
      saveTenantBudget(gateway, data.tenant, {
        monthlyTokens: data.monthlyTokens,
        perMinute: data.perMinute,
      }),
    ),
  );
