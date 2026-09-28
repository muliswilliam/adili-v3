import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  byClientIp,
  RATE_LIMIT_HEADERS,
  RateLimit,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';

import { ApiSessionRoute, OnboardingController, SessionSecret } from '../public-route.js';
import {
  type OnboardingSession,
  otpChannelSchema,
  type ProvideOnboardingContactBody,
  provideOnboardingContactBody,
  type VerifyOnboardingOtpBody,
  verifyOnboardingOtpBody,
} from '../representation.js';
import type { OtpChannel } from '../session-state.js';
import { OnboardingCodesService } from './codes.service.js';

const ApiChannelParam = () =>
  ApiParam({ name: 'channel', schema: schemaRef('OtpChannel'), description: 'email or phone' });

const WRONG_STEP_409 = (waitingFor: string) =>
  ApiProblemResponse(
    409,
    `Problem code \`wrong-step\`: the session is not waiting for ${waitingFor}; re-read it`,
    'OnboardingProblem',
  );

const SEND_FAILED_502 = ApiProblemResponse(
  502,
  'Problem code `otp-send-failed`: the code could not be sent; nothing changed, try again',
  'OnboardingProblem',
);

/** Verifying and resending one-time codes, and supplying a contact the roster lacks. */
@OnboardingController()
@Controller('v1/onboarding/sessions/:sessionId')
@RateLimit('onboarding-session', { key: byClientIp })
export class OnboardingCodesController {
  constructor(private readonly codes: OnboardingCodesService) {}

  @Post('otp/:channel/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'verifyOnboardingOtp',
    summary: 'Verify the 6-digit code for a channel',
    description:
      'Public, with the session secret; rate-limited per client IP. The right code verifies the contact and moves the session on: after email to the phone (its code sent at once, or `phone-contact-required`), after phone to `phone-verified`. Five wrong codes end the session (410).',
  })
  @ApiSessionRoute()
  @ApiChannelParam()
  @ApiBody({ schema: schemaRef('VerifyOnboardingOtp') })
  @ApiOkResponse({
    description: 'Verified; the session moved on',
    schema: schemaRef('OnboardingSession'),
    headers: RATE_LIMIT_HEADERS,
  })
  @ApiProblemResponse(
    400,
    'Problem code `otp-invalid` (with `attemptsLeft`) or `otp-expired`; a body failing validation has no code',
    'OnboardingProblem',
  )
  @WRONG_STEP_409("this channel's code")
  @SEND_FAILED_502
  verify(
    @Param('sessionId') sessionId: string,
    @Param('channel', new ZodValidationPipe(otpChannelSchema)) channel: OtpChannel,
    @SessionSecret() secret: string | undefined,
    @Body(new ZodValidationPipe(verifyOnboardingOtpBody)) body: VerifyOnboardingOtpBody,
  ): Promise<OnboardingSession> {
    return this.codes.verify(sessionId, secret, channel, body.code);
  }

  @Post('otp/:channel/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'resendOnboardingOtp',
    summary: 'Send a new code (60-second cooldown, at most 3 per channel)',
    description:
      'Public, with the session secret; rate-limited per client IP. The new code replaces the old one. A fourth resend of a channel ends the session (410). Re-read the session for the next `resendAvailableAt` and `resendsLeft`.',
  })
  @ApiSessionRoute()
  @ApiChannelParam()
  @ApiAcceptedResponse({ description: 'New code sent', headers: RATE_LIMIT_HEADERS })
  @WRONG_STEP_409("this channel's code")
  @ApiProblemResponse(
    429,
    'Problem code `resend-cooldown` (with `retryAfterSeconds`) or `rate-limit-exceeded` (with `retryAfterSeconds` and Retry-After)',
    'OnboardingProblem',
  )
  @SEND_FAILED_502
  resend(
    @Param('sessionId') sessionId: string,
    @Param('channel', new ZodValidationPipe(otpChannelSchema)) channel: OtpChannel,
    @SessionSecret() secret: string | undefined,
  ): Promise<void> {
    return this.codes.resend(sessionId, secret, channel);
  }

  @Post('contacts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'provideOnboardingContact',
    summary: 'Supply an email or phone when the roster record has none',
    description:
      'Public, with the session secret; rate-limited per client IP. Only while the session waits for that contact (`*-contact-required`). The value is normalised (email lower-cased, phone to E.164) and its first code sent; once verified it is written to the roster record with source `declarant`.',
  })
  @ApiSessionRoute()
  @ApiBody({ schema: schemaRef('ProvideOnboardingContact') })
  @ApiOkResponse({
    description: 'Contact accepted and its code sent',
    schema: schemaRef('OnboardingSession'),
    headers: RATE_LIMIT_HEADERS,
  })
  @ApiProblemResponse(400, 'Body failed validation (e.g. not a valid email or phone number)')
  @WRONG_STEP_409('this contact')
  @SEND_FAILED_502
  provideContact(
    @Param('sessionId') sessionId: string,
    @SessionSecret() secret: string | undefined,
    @Body(new ZodValidationPipe(provideOnboardingContactBody)) body: ProvideOnboardingContactBody,
  ): Promise<OnboardingSession> {
    return this.codes.provideContact(sessionId, secret, body);
  }
}
