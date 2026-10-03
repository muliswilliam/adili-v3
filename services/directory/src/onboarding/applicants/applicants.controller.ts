import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  type AuthenticatedRequest,
  byClientIp,
  RATE_LIMIT_HEADERS,
  RateLimit,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';

import { OnboardingCodesService } from '../codes/codes.service.js';
import { PasswordEmailService } from '../password-email/password-email.service.js';
import {
  ApiSessionRoute,
  IDENTIFY_RATE_LIMIT,
  OnboardingController,
  SessionCredentials,
  SessionIdempotencyKey,
} from '../public-route.js';
import { type VerifyOnboardingOtpBody, verifyOnboardingOtpBody } from '../representation.js';
import { OnboardingSessions } from '../sessions.repository.js';
import { ApplicantCompleteService } from './complete.service.js';
import {
  type ApplicantOnboardingSession,
  type ApplicantOnboardingSessionCreated,
  type StartApplicantOnboardingBody,
  startApplicantOnboardingBody,
} from './representation.js';
import { ApplicantStartService } from './start.service.js';

const PROBLEM = 'ApplicantOnboardingProblem';

const SESSION_RESPONSE = {
  schema: schemaRef('ApplicantOnboardingSession'),
  headers: RATE_LIMIT_HEADERS,
};

const WRONG_STEP_409 = (waitingFor: string) =>
  ApiProblemResponse(
    409,
    `Problem code \`wrong-step\`: the session is not waiting for ${waitingFor}; re-read it`,
    PROBLEM,
  );

const SEND_FAILED_502 = ApiProblemResponse(
  502,
  'Problem code `otp-send-failed`: the code could not be sent; nothing changed, try again',
  PROBLEM,
);

/** Starting applicant onboarding (spec 10): the public's way to an applicant account. */
@OnboardingController()
@Controller('v1/onboarding/applicants')
export class ApplicantStartController {
  constructor(private readonly applicants: ApplicantStartService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit(IDENTIFY_RATE_LIMIT, { key: byClientIp })
  @ApiOperation({
    operationId: 'startApplicantOnboarding',
    summary:
      'Start onboarding as a public applicant (national ID with IPRS check, or passport pending manual verification)',
    description:
      "Public, rate-limited per client IP (the budget of identify, which a session that runs out of codes or resends also uses up). A national ID is checked with IPRS against the names entered first (`identity-mismatch` if IPRS disagrees); a passport is not checked, and the account will be `pending-verification` until an access officer verifies it. The phone's code is sent at once. On success the response carries the session and, once only, the session secret the BFF stores in an httpOnly cookie.",
  })
  @ApiBody({ schema: schemaRef('StartApplicantOnboarding') })
  @ApiCreatedResponse({
    description: 'Session started; the code sent to the phone (`phone-pending`)',
    schema: schemaRef('ApplicantOnboardingSessionCreated'),
    headers: RATE_LIMIT_HEADERS,
  })
  @ApiProblemResponse(400, 'Body failed validation')
  @ApiProblemResponse(
    409,
    'Problem code `identity-mismatch`: IPRS has no person with this national ID under these names; or `already-onboarded` (with `links`): an applicant account has this document',
    PROBLEM,
  )
  @ApiProblemResponse(
    429,
    'Problem code `rate-limit-exceeded` (with `retryAfterSeconds` and Retry-After)',
    PROBLEM,
  )
  @ApiProblemResponse(
    502,
    'Problem code `otp-send-failed`: the code could not be sent; no session was created',
    PROBLEM,
  )
  @ApiProblemResponse(
    503,
    'Problem code `iprs-unavailable`: IPRS could not be checked; try again later',
    PROBLEM,
  )
  start(
    @Body(new ZodValidationPipe(startApplicantOnboardingBody)) body: StartApplicantOnboardingBody,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApplicantOnboardingSessionCreated> {
    return this.applicants.start(body, request.ip);
  }
}

/**
 * The steps of an applicant's session (spec 10): reading it, the phone's code, completing it and
 * resending the set-password email. A declarant's session is 404 here, as an applicant's is on
 * the declarant routes.
 */
@OnboardingController()
@Controller('v1/onboarding/applicants/:sessionId')
@RateLimit('onboarding-session', { key: byClientIp })
export class ApplicantSessionController {
  constructor(
    private readonly sessions: OnboardingSessions,
    private readonly codes: OnboardingCodesService,
    private readonly completion: ApplicantCompleteService,
    private readonly passwordEmail: PasswordEmailService,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'getApplicantOnboardingSession',
    summary: 'Current step, masked contacts and the identity status the account gets',
    description: 'Public, with the session secret; rate-limited per client IP.',
  })
  @ApiSessionRoute()
  @ApiOkResponse({ description: 'The session', ...SESSION_RESPONSE })
  get(@SessionCredentials() credentials: SessionCredentials): Promise<ApplicantOnboardingSession> {
    return this.sessions.withLiveApplicantSession(credentials, ({ tx, session, now }) =>
      this.sessions.applicantView(tx, session, now),
    );
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'verifyApplicantOnboardingOtp',
    summary: "Verify the phone's 6-digit code",
    description:
      'Public, with the session secret; rate-limited per client IP. The right code verifies the phone (`phone-verified`, the complete step). Five wrong codes end the session (410), which also uses up a start attempt of the client IP.',
  })
  @ApiSessionRoute()
  @ApiBody({ schema: schemaRef('VerifyOnboardingOtp') })
  @ApiOkResponse({ description: 'Verified; the session moved on', ...SESSION_RESPONSE })
  @ApiProblemResponse(
    400,
    'Problem code `otp-invalid` (with `attemptsLeft`) or `otp-expired`; a body failing validation has no code',
    PROBLEM,
  )
  @WRONG_STEP_409("the phone's code")
  verify(
    @SessionCredentials() credentials: SessionCredentials,
    @Body(new ZodValidationPipe(verifyOnboardingOtpBody)) body: VerifyOnboardingOtpBody,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApplicantOnboardingSession> {
    return this.codes.verifyApplicant(credentials, body.code, byClientIp(request));
  }

  @Post('otp/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'resendApplicantOnboardingOtp',
    summary: 'Send a new phone code (60-second cooldown, at most 3)',
    description:
      'Public, with the session secret; rate-limited per client IP. The new code replaces the old one. A fourth resend ends the session (410), which also uses up a start attempt of the client IP. Re-read the session for the next `resendAvailableAt` and `resendsLeft`.',
  })
  @ApiSessionRoute()
  @ApiAcceptedResponse({ description: 'New code sent', headers: RATE_LIMIT_HEADERS })
  @WRONG_STEP_409("the phone's code")
  @ApiProblemResponse(
    429,
    'Problem code `resend-cooldown` (with `retryAfterSeconds`) or `rate-limit-exceeded` (with `retryAfterSeconds` and Retry-After)',
    PROBLEM,
  )
  @SEND_FAILED_502
  resend(
    @SessionCredentials() credentials: SessionCredentials,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.codes.resend(credentials, 'phone', byClientIp(request), 'applicant');
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'completeApplicantOnboarding',
    summary: 'Create the applicant account and send its set-password email',
    description:
      'Public, with the session secret; rate-limited per client IP. From `phone-verified` only. Creates the person (kind `applicant`) and the account (role `applicant`, no tenant, `identityStatus` `verified` for a national ID, `pending-verification` for a passport), then sends the set-password email; should that fail the account stands and the session says `setPasswordEmail: failed`. Idempotent per Idempotency-Key: a retry gets the first answer back.',
  })
  @SessionIdempotencyKey()
  @ApiSessionRoute()
  @ApiOkResponse({ description: 'Account created; the session as it now is', ...SESSION_RESPONSE })
  @ApiProblemResponse(
    409,
    'Problem code `wrong-step` (the BFF re-reads the session), `already-onboarded` (an applicant account has this document) or `email-in-use` (the email belongs to another account); nothing changed',
    PROBLEM,
  )
  @ApiProblemResponse(
    502,
    'Problem code `identity-unavailable`: the account could not be created; nothing changed',
    PROBLEM,
  )
  complete(
    @SessionCredentials() credentials: SessionCredentials,
  ): Promise<ApplicantOnboardingSession> {
    return this.completion.complete(credentials);
  }

  @Post('resend-password-email')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'resendApplicantSetPasswordEmail',
    summary: 'Send the set-password email again',
    description:
      'Public, with the session secret; rate-limited per client IP. Only for a completed session, a minute after the last email, until 24 hours after complete (the session `expiresAt`, then 410); the session then says when the next may be sent (`otp.resendAvailableAt`). Idempotent per Idempotency-Key: a retry sends no second email.',
  })
  @SessionIdempotencyKey()
  @ApiSessionRoute()
  @ApiAcceptedResponse({ description: 'Email requested', headers: RATE_LIMIT_HEADERS })
  @WRONG_STEP_409('a set-password email (it is not completed)')
  @ApiProblemResponse(429, 'Problem code `resend-cooldown` with `retryAfterSeconds`', PROBLEM)
  @ApiProblemResponse(
    502,
    'Problem code `identity-unavailable`: the email could not be sent; try again',
    PROBLEM,
  )
  resendPasswordEmail(@SessionCredentials() credentials: SessionCredentials): Promise<void> {
    return this.passwordEmail.resend(credentials, 'applicant');
  }
}
