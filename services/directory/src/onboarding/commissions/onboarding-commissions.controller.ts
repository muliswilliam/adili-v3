import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  byClientIp,
  RATE_LIMIT_HEADERS,
  RateLimit,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';

import { OnboardingController } from '../public-route.js';
import {
  type ListOnboardingCommissionsQuery,
  listOnboardingCommissionsQuery,
  type OnboardingCommission,
} from '../representation.js';
import { OnboardingCommissionsService } from './onboarding-commissions.service.js';

@OnboardingController()
@Controller('v1/onboarding/commissions')
export class OnboardingCommissionsController {
  constructor(private readonly commissions: OnboardingCommissionsService) {}

  @Get()
  @RateLimit('onboarding-commissions', { key: byClientIp })
  @ApiOperation({
    operationId: 'listOnboardingCommissions',
    summary: 'Active Responsible Commissions a declarant can choose from',
    description:
      'Public, rate-limited per client IP. Ordered by name; may be up to a minute behind (cached).',
  })
  @ApiQueryParameters(listOnboardingCommissionsQuery)
  @ApiOkResponse({
    description: 'Commissions with roster availability',
    schema: { type: 'array', items: schemaRef('OnboardingCommission') },
    headers: RATE_LIMIT_HEADERS,
  })
  @ApiProblemResponse(400, 'Query failed validation')
  list(
    @Query(new ZodValidationPipe(listOnboardingCommissionsQuery))
    query: ListOnboardingCommissionsQuery,
  ): Promise<OnboardingCommission[]> {
    return this.commissions.list(query);
  }
}
