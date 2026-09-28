import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../clock.js';
import { OnboardingCommissionsController } from './commissions/onboarding-commissions.controller.js';
import { OnboardingCommissionsService } from './commissions/onboarding-commissions.service.js';
import { ConfirmController } from './confirm/confirm.controller.js';
import { ConfirmService } from './confirm/confirm.service.js';
import { IdentifyFailureCounter } from './identify/failure-counter.js';
import { IdentifyController } from './identify/identify.controller.js';
import { IdentifyService } from './identify/identify.service.js';
import { iprsLookupProvider } from './iprs/iprs-lookup.provider.js';
import { OtpDelivery, UnconfiguredOtpDelivery } from './otp/otp-delivery.js';
import { OtpIssuer } from './otp/otp-issuer.js';
import { PasswordEmailController } from './password-email/password-email.controller.js';
import { PasswordEmailService } from './password-email/password-email.service.js';
import { OnboardingSessionSweeper } from './sessions/expiry-sweep.js';
import { OnboardingSessionsController } from './sessions/sessions.controller.js';
import { OnboardingSessions } from './sessions.repository.js';

/**
 * Declarant onboarding (spec 03): the public routes under `/v1/onboarding` that turn a roster
 * record into a declarant account.
 *
 * - `session-state.ts`: states, allowed moves, timing rules (pure).
 * - `sessions.repository.ts`: `OnboardingSessions`, the only way to read and change a session:
 *   `withLiveSession` (secret check, 404/410, row lock, tenant context), `transition` / `end`
 *   (state machine, expiry, audit events), `view` (the contract's `OnboardingSession`).
 * - One folder per step, each with its own controller under `v1/onboarding/...` using
 *   `@OnboardingController()`, and for session routes `@ApiSessionRoute()`, `@SessionSecret()`
 *   and the `onboarding-session` rate limit (`public-route.ts`): `commissions/`, `identify/`,
 *   `sessions/` (read, expiry sweep), `confirm/` (IPRS check, person and OFR, account created or
 *   linked), `password-email/` (resending the set-password email); codes and contacts join as a
 *   folder of their own.
 * - `otp/`: `OtpIssuer` (code, HMAC, `onboarding_otps` row, send) behind the `OtpDelivery` port.
 * - `iprs/`: the `IprsLookup` port onto the integration-gateway and the confirm step's name rule.
 * - `events.ts`: every onboarding event; `rejection.ts`: fail after committing (attempt counts).
 */
@Module({
  controllers: [
    OnboardingCommissionsController,
    IdentifyController,
    OnboardingSessionsController,
    ConfirmController,
    PasswordEmailController,
  ],
  providers: [
    { provide: Clock, useClass: SystemClock },
    { provide: OtpDelivery, useClass: UnconfiguredOtpDelivery },
    OnboardingSessions,
    OnboardingCommissionsService,
    IdentifyService,
    IdentifyFailureCounter,
    OtpIssuer,
    OnboardingSessionSweeper,
    iprsLookupProvider,
    ConfirmService,
    PasswordEmailService,
  ],
})
export class OnboardingModule {}
