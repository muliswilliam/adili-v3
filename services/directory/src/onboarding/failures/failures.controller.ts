import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  Roles,
  schemaRef,
} from '@adili/api-kit';

import { IMPORT_READ_ROLES } from '../../roster/import/imports.controller.js';
import { OnboardingFailures } from './onboarding-failures.js';
import type { OnboardingFailuresView } from './representation.js';

@ApiTags('roster')
@Controller('v1/commissions/:slug/roster/onboarding-failures')
@ApiParam({ name: 'slug', schema: schemaRef('Slug') })
export class OnboardingFailuresController {
  constructor(private readonly failures: OnboardingFailures) {}

  @Get()
  @Roles(...IMPORT_READ_ROLES)
  @ApiOperation({
    operationId: 'getOnboardingFailures',
    summary: 'Failed onboarding attempts against the Commission in the last 24 hours',
    description:
      "The Commission's reporting officer and commission admin; platform admin, EACC analyst and supervisor for every Commission. Counts only, no identifiers: many failures point to a stale roster or an attack (spec 03, story 30).",
  })
  @ApiOkResponse({
    description: 'Failed attempts by hour',
    schema: schemaRef('OnboardingFailures'),
  })
  @ApiProblemResponse(404, 'Not found: another Commission, or the Commission does not exist')
  recent(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
  ): Promise<OnboardingFailuresView> {
    return this.failures.recent(principal, slug);
  }
}
