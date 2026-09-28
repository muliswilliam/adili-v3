import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  byClientIp,
  RATE_LIMIT_HEADERS,
  RateLimit,
  schemaRef,
} from '@adili/api-kit';

import {
  ApiSessionRoute,
  OnboardingController,
  SessionIdempotencyKey,
  SessionSecret,
} from '../public-route.js';
import type { OnboardingConfirmResult } from '../representation.js';
import { ConfirmService } from './confirm.service.js';

@OnboardingController()
@Controller('v1/onboarding/sessions/:sessionId/confirm')
@RateLimit('onboarding-session', { key: byClientIp })
export class ConfirmController {
  constructor(private readonly confirmation: ConfirmService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'confirmOnboarding',
    summary: 'Confirm roster details, run the IPRS check and create or link the account',
    description:
      'Public, with the session secret; rate-limited per client IP. From `phone-verified` only. An IPRS mismatch (or no IPRS record) is a 200 with outcome `identity-mismatch`: the session ends and the roster record is flagged for its reporting officer. A match creates the account and sends the set-password email (`account-created`), or links the record to the account the person already has from another Commission (`linked-existing-account`). Idempotent per Idempotency-Key: a retry gets the first answer back.',
  })
  @ApiSessionRoute()
  @SessionIdempotencyKey()
  @ApiOkResponse({
    description: 'Outcome of the confirmation, with the session as it now is',
    schema: schemaRef('OnboardingConfirmResult'),
    headers: RATE_LIMIT_HEADERS,
  })
  @ApiProblemResponse(
    409,
    'The session is not at the confirm step (the BFF re-reads it), or problem code `email-in-use`: the verified email belongs to another account; nothing changed',
    'OnboardingProblem',
  )
  @ApiProblemResponse(
    502,
    'Problem code `identity-unavailable`: the account could not be created or linked; nothing changed',
    'OnboardingProblem',
  )
  @ApiProblemResponse(
    503,
    'Problem code `iprs-unavailable`: IPRS could not be checked; try again later, the session is unchanged',
    'OnboardingProblem',
  )
  confirm(
    @Param('sessionId') sessionId: string,
    @SessionSecret() secret: string | undefined,
  ): Promise<OnboardingConfirmResult> {
    return this.confirmation.confirm(sessionId, secret);
  }
}
