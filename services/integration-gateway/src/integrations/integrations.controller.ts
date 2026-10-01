import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles, schemaRef } from '@adili/api-kit';
import { PLATFORM_ADMIN } from '@adili/roles';

import { Coverage, type SystemCoverage } from './coverage.js';

/** How the registry integrations behave, for platform administrators (spec 07b). */
@ApiTags('integrations')
@ApiBearerAuth()
@Roles(PLATFORM_ADMIN)
@Controller('v1/integrations')
export class IntegrationsController {
  constructor(private readonly coverage: Coverage) {}

  @Get('coverage')
  @ApiOperation({
    operationId: 'getIntegrationsCoverage',
    summary: 'Per-system call volume, cache hit rate, breaker state and last success',
    description:
      'Every system with an adapter (IPRS, KRA, NTSA, BRS, ArdhiSasa): lookups and failed calls in the last 24 hours, cache hit rate, breaker state, last success, paused, and the configured rate limit, cache lifetime, timeout and breaker rule. Platform administrators only.',
  })
  @ApiOkResponse({ description: 'Coverage per system', schema: schemaRef('Coverage') })
  getCoverage(): Promise<SystemCoverage[]> {
    return this.coverage.read();
  }
}
