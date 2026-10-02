import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { schemaRef, Scopes } from '@adili/api-kit';
import { REGISTRY_SCOPE } from '@adili/roles';
import { z } from 'zod';

import { SYSTEM_POLICIES, type SystemPolicies } from '../adapter-kit/system-policies.js';
import { SYSTEMS } from '../db/schema.js';
import { systemSchema } from './registry-records.js';

export const registryRateLimitsSchema = z
  .array(
    z.object({
      system: systemSchema,
      /** Calls per minute the gateway sends the system, across every instance. */
      ratePerMinute: z.int().positive(),
    }),
  )
  .meta({ description: 'The configured rate limit of every system with an adapter' });
export type RegistryRateLimits = z.infer<typeof registryRateLimitsSchema>;

/**
 * Internal: the systems' configured rate limits, so a caller can pace its own batch work under
 * them (review's hourly sweep of registry checks, spec 07b "bounded per run by the rate limits").
 * Configuration, not tenant data: the scope alone admits the call.
 */
@ApiTags('internal')
@ApiBearerAuth()
@Scopes(REGISTRY_SCOPE)
@Controller('internal/v1/registry-rate-limits')
export class RegistryRateLimitsController {
  constructor(@Inject(SYSTEM_POLICIES) private readonly policies: SystemPolicies) {}

  @Get()
  @ApiOperation({
    operationId: 'getRegistryRateLimits',
    summary: 'Configured calls per minute of every system with an adapter (services)',
    description: `Service tokens with scope \`${REGISTRY_SCOPE}\`; no X-Acting-Tenant (configuration, no tenant data). A lookup answered from the cache spends none of it; every call to the registry spends one, so a KRA lookup spends 1 + one per PIN.`,
  })
  @ApiOkResponse({ description: 'Rate limits per system', schema: schemaRef('RegistryRateLimits') })
  read(): RegistryRateLimits {
    return SYSTEMS.flatMap((system) => {
      const policy = this.policies[system];
      return policy ? [{ system, ratePerMinute: policy.ratePerMinute }] : [];
    });
  }
}
