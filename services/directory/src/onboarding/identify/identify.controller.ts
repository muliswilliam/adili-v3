import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOperation } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  type AuthenticatedRequest,
  byClientIp,
  byClientIpAnd,
  RATE_LIMIT_HEADERS,
  RateLimit,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';

import { IDENTIFY_RATE_LIMIT, OnboardingController } from '../public-route.js';
import {
  type IdentifyDeclarantBody,
  identifyDeclarantBody,
  type OnboardingSessionCreated,
} from '../representation.js';
import { IdentifyService } from './identify.service.js';

@OnboardingController()
@Controller('v1/onboarding/sessions')
export class IdentifyController {
  constructor(private readonly identify: IdentifyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit(IDENTIFY_RATE_LIMIT, { key: byClientIp, refundOn: ['no-roster'] })
  @RateLimit('onboarding-identify-commission', {
    key: byClientIpAnd({ body: 'commission' }),
    refundOn: ['no-roster'],
  })
  @ApiOperation({
    operationId: 'identifyDeclarant',
    summary: "Match personnel file number and national ID against a Commission's roster",
    description:
      'Public, rate-limited per client IP and per client IP and Commission (a slug that is no active Commission with a roster uses up neither; a session of the client IP that ran out of codes or resends uses up a per client IP attempt). Every non-match cause returns the same `no-match` problem. On success the response carries the session and, once only, the session secret the BFF stores in an httpOnly cookie.',
  })
  @ApiBody({ schema: schemaRef('IdentifyDeclarant') })
  @ApiCreatedResponse({
    description:
      'Session created: the first code sent to the roster email (`email-pending`), or an email is required (`email-contact-required`)',
    schema: schemaRef('OnboardingSessionCreated'),
    headers: RATE_LIMIT_HEADERS,
  })
  @ApiProblemResponse(400, 'Body failed validation')
  @ApiProblemResponse(404, 'Problem code `no-match`', 'OnboardingProblem')
  @ApiProblemResponse(
    409,
    'Problem code `already-onboarded` (with `links`), or `no-roster`: no active Commission with that slug, or it has not imported a roster',
    'OnboardingProblem',
  )
  @ApiProblemResponse(
    502,
    'Problem code `otp-send-failed`: the first code could not be sent; no session was created',
    'OnboardingProblem',
  )
  create(
    @Body(new ZodValidationPipe(identifyDeclarantBody)) body: IdentifyDeclarantBody,
    @Req() request: AuthenticatedRequest,
  ): Promise<OnboardingSessionCreated> {
    return this.identify.identify(body, request.ip);
  }
}
