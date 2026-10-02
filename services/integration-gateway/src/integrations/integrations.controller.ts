import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  AcceptIdempotencyKey,
  ApiProblemResponse,
  CurrentPrincipal,
  notFoundIfInvisible,
  type Principal,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { PLATFORM_ADMIN } from '@adili/roles';

import type { System } from '../db/schema.js';
import { systemSchema } from '../registries/registry-records.js';
import { Coverage, type SystemCoverage } from './coverage.js';
import { IntegrationSettings } from './integration-settings.js';

const systemParam = ApiParam({ name: 'system', schema: schemaRef('System') });
const NO_ADAPTER = 'No adapter for the system (payroll and ICMS have no coverage to pause)';
const FLAG_UNAVAILABLE =
  'Problem type `pause-flag-unavailable`: the change is recorded but the pause flag could not be written; retry to apply it';

/** How the registry integrations behave, for platform administrators (spec 07b). */
@ApiTags('integrations')
@ApiBearerAuth()
@Roles(PLATFORM_ADMIN)
@Controller('v1/integrations')
export class IntegrationsController {
  constructor(
    private readonly coverage: Coverage,
    private readonly settings: IntegrationSettings,
  ) {}

  @Get('coverage')
  @ApiOperation({
    operationId: 'getIntegrationsCoverage',
    summary: 'Per-system call volume, cache hit rate, breaker state and last success',
    description:
      'Every system with an adapter (IPRS, KRA, NTSA, BRS, ArdhiSasa): lookups and failed calls in the last 24 hours, cache hit rate, breaker state, last success, paused (by whom and since when), and the configured rate limit, cache lifetime, timeout and breaker rule. Platform administrators only.',
  })
  @ApiOkResponse({ description: 'Coverage per system', schema: schemaRef('Coverage') })
  getCoverage(): Promise<SystemCoverage[]> {
    return this.coverage.read();
  }

  @Post(':system/pause')
  @AcceptIdempotencyKey()
  @HttpCode(HttpStatus.OK)
  @systemParam
  @ApiOperation({
    operationId: 'pauseIntegration',
    summary: 'Force lookups to unavailable during a known outage (platform-admin)',
    description:
      "From now on the system's lookups answer `unavailable` with reason `paused` without calling it; answers still in the cache are served. Records who paused it and when, and `integrations.system.paused.v1`. Pausing a paused system changes nothing. Platform administrators only.",
  })
  @ApiOkResponse({ description: 'Paused', schema: schemaRef('SystemCoverage') })
  @ApiProblemResponse(HttpStatus.NOT_FOUND, NO_ADAPTER)
  @ApiProblemResponse(HttpStatus.SERVICE_UNAVAILABLE, FLAG_UNAVAILABLE)
  async pause(
    @Param('system', new ZodValidationPipe(systemSchema)) system: System,
    @CurrentPrincipal() principal: Principal,
  ): Promise<SystemCoverage> {
    await this.settings.pause(this.covered(system), principal);
    return this.coverage.readOne(system);
  }

  @Post(':system/resume')
  @AcceptIdempotencyKey()
  @HttpCode(HttpStatus.OK)
  @systemParam
  @ApiOperation({
    operationId: 'resumeIntegration',
    summary: 'Resume lookups (platform-admin)',
    description:
      'Lookups call the system again, within its rate limit and behind its breaker. Records `integrations.system.resumed.v1`. Resuming a system that is not paused changes nothing. Platform administrators only.',
  })
  @ApiOkResponse({ description: 'Resumed', schema: schemaRef('SystemCoverage') })
  @ApiProblemResponse(HttpStatus.NOT_FOUND, NO_ADAPTER)
  @ApiProblemResponse(HttpStatus.SERVICE_UNAVAILABLE, FLAG_UNAVAILABLE)
  async resume(
    @Param('system', new ZodValidationPipe(systemSchema)) system: System,
    @CurrentPrincipal() principal: Principal,
  ): Promise<SystemCoverage> {
    await this.settings.resume(this.covered(system), principal);
    return this.coverage.readOne(system);
  }

  private covered(system: System): System {
    return notFoundIfInvisible(this.coverage.covers(system) ? system : null);
  }
}
