import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOperation } from '@nestjs/swagger';
import { ApiProblemResponse, byClientIp, RATE_LIMIT_HEADERS, RateLimit } from '@adili/api-kit';

import {
  ApiSessionRoute,
  OnboardingController,
  SessionIdempotencyKey,
  SessionSecret,
} from '../public-route.js';
import { PasswordEmailService } from './password-email.service.js';

@OnboardingController()
@Controller('v1/onboarding/sessions/:sessionId/resend-password-email')
@RateLimit('onboarding-session', { key: byClientIp })
export class PasswordEmailController {
  constructor(private readonly passwordEmail: PasswordEmailService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'resendSetPasswordEmail',
    summary: 'Send the set-password email again',
    description:
      'Public, with the session secret; rate-limited per client IP. Only for a session confirmed with a new account (`account-created`), a minute after the last email; the session then says when the next may be sent (`otp.resendAvailableAt`). Idempotent per Idempotency-Key: a retry sends no second email.',
  })
  @ApiSessionRoute()
  @SessionIdempotencyKey()
  @ApiAcceptedResponse({ description: 'Email requested', headers: RATE_LIMIT_HEADERS })
  @ApiProblemResponse(
    409,
    'The session is not confirmed with a new account (the BFF re-reads it)',
    'OnboardingProblem',
  )
  @ApiProblemResponse(
    429,
    'Problem code `resend-cooldown` with `retryAfterSeconds`',
    'OnboardingProblem',
  )
  @ApiProblemResponse(
    502,
    'Problem code `identity-unavailable`: the email could not be sent; try again',
    'OnboardingProblem',
  )
  resend(
    @Param('sessionId') sessionId: string,
    @SessionSecret() secret: string | undefined,
  ): Promise<void> {
    return this.passwordEmail.resend(sessionId, secret);
  }
}
