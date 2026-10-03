import { ApiParam, ApiQuery } from '@nestjs/swagger';
import { PLATFORM_TENANT, TENANT_KEY } from '@adili/api-kit';
import { z } from 'zod';

import { DATA_CLASSES } from '../jobs/task-request.js';
import { gateCellSchema } from '../policy/gate-policies.js';
import { PROVIDER_CLASSES } from '../providers/port.js';
import { TASK_NAMES } from '../tasks/task.js';

/**
 * The `tenant` path parameter (contract `Tenant`): a tenant key, never the reserved `platform`
 * context of cross-tenant work.
 */
export const tenantParam = z
  .string()
  .regex(TENANT_KEY)
  .refine((tenant) => tenant !== PLATFORM_TENANT, { message: 'Must name a tenant' });

/** Documents the `tenant` path parameter. */
export const ApiTenantParam = () =>
  ApiParam({ name: 'tenant', schema: { type: 'string', pattern: TENANT_KEY.source } });

/** Contract `GatePolicyInput`: one rule per pair at most, applied together. */
export const gatePolicyInput = z.strictObject({
  rules: z
    .array(gateCellSchema)
    .min(1)
    .max(DATA_CLASSES.length * PROVIDER_CLASSES.length)
    .refine(
      (rules) =>
        new Set(rules.map((rule) => `${rule.dataClass}|${rule.providerClass}`)).size ===
        rules.length,
      { message: 'At most one rule per data class and provider class' },
    )
    .meta({ description: 'At most one rule per data class and provider class' }),
  approvalRef: z.string().trim().min(1).max(200).meta({
    description: 'The decision the change rests on, e.g. an EACC approval number',
  }),
});

/** Contract `BudgetInput`. */
export const budgetInput = z.strictObject({
  monthlyTokens: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .meta({ description: 'Tokens (in and out) per calendar month, Africa/Nairobi' }),
  perMinute: z
    .number()
    .int()
    .min(1)
    .max(2_147_483_647)
    .meta({ description: 'Jobs created per minute' }),
});

/** The `approvalRef` query parameter of a route removal. */
export const approvalRefQuery = z.string().trim().min(1).max(200);

/** Documents the `task` path parameter. */
export const ApiTaskParam = () =>
  ApiParam({ name: 'task', schema: { type: 'string', enum: [...TASK_NAMES] } });

/** Documents the `approvalRef` query parameter. */
export const ApiApprovalQuery = () =>
  ApiQuery({
    name: 'approvalRef',
    required: true,
    description: 'The decision the change rests on, e.g. an EACC approval number',
    schema: { type: 'string', minLength: 1, maxLength: 200 },
  });
