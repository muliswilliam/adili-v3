import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { byClientIp, RATE_LIMIT_HEADERS, RateLimit, schemaRef } from '@adili/api-kit';

import { ApiSessionRoute, OnboardingController, SessionCredentials } from '../public-route.js';
import type { OnboardingSession } from '../representation.js';
import { OnboardingSessions } from '../sessions.repository.js';

/**
 * Reading a session. The steps that change one live in controllers of their own under the same
 * path (codes and contacts, confirm), each with `@ApiSessionRoute()`, `@SessionCredentials()` and the
 * `onboarding-session` rate limit.
 */
@OnboardingController()
@Controller('v1/onboarding/sessions/:sessionId')
@RateLimit('onboarding-session', { key: byClientIp })
export class OnboardingSessionsController {
  constructor(private readonly sessions: OnboardingSessions) {}

  @Get()
  @ApiOperation({
    operationId: 'getOnboardingSession',
    summary: 'Current step, masked contacts and roster details to confirm',
    description: 'Public, with the session secret; rate-limited per client IP.',
  })
  @ApiSessionRoute()
  @ApiOkResponse({
    description: 'The session',
    schema: schemaRef('OnboardingSession'),
    headers: RATE_LIMIT_HEADERS,
  })
  get(@SessionCredentials() credentials: SessionCredentials): Promise<OnboardingSession> {
    return this.sessions.withLiveSession(credentials, ({ tx, session, now }) =>
      this.sessions.view(tx, session, now),
    );
  }
}
