import { TENANT_KEY } from '@adili/api-kit';
import { z } from 'zod';

import { DATA_CLASSES } from '../jobs/task-request.js';
import { PROVIDER_CLASSES } from '../providers/port.js';

/** The `tenant` path parameter (contract `Tenant`). */
export const tenantParam = z.string().regex(TENANT_KEY);

/** Contract `GatePolicyInput`: one rule per pair at most, applied together. */
export const gatePolicyInput = z.strictObject({
  rules: z
    .array(
      z.strictObject({
        dataClass: z.enum(DATA_CLASSES),
        providerClass: z.enum(PROVIDER_CLASSES),
        allowed: z.boolean(),
      }),
    )
    .min(1)
    .max(DATA_CLASSES.length * PROVIDER_CLASSES.length)
    .refine(
      (rules) =>
        new Set(rules.map((rule) => `${rule.dataClass}|${rule.providerClass}`)).size ===
        rules.length,
      { message: 'At most one rule per data class and provider class' },
    ),
  approvalRef: z.string().trim().min(1).max(200),
});

/** Contract `BudgetInput`. */
export const budgetInput = z.strictObject({
  monthlyTokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  perMinute: z.number().int().min(1).max(2_147_483_647),
});
