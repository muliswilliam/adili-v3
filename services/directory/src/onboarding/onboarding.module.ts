import { Module } from '@nestjs/common';
import { ServiceTokenClient } from '@adili/api-kit';

import { Clock, SystemClock } from '../clock.js';
import { config } from '../config.js';
import { OnboardingCodesController } from './codes/codes.controller.js';
import { OnboardingCodesService } from './codes/codes.service.js';
import { OnboardingCommissionsController } from './commissions/onboarding-commissions.controller.js';
import { OnboardingCommissionsService } from './commissions/onboarding-commissions.service.js';
import { IdentifyFailureCounter } from './identify/failure-counter.js';
import { IdentifyController } from './identify/identify.controller.js';
import { IdentifyService } from './identify/identify.service.js';
import {
  NOTIFICATIONS_MESSAGES_SCOPE,
  NotificationsOtpDelivery,
} from './otp/notifications-otp-delivery.js';
import { OtpDelivery } from './otp/otp-delivery.js';
import { OtpIssuer } from './otp/otp-issuer.js';
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
 *   `sessions/` (read, expiry sweep); codes and contacts, confirm and the set-password email
 *   join as folders of their own.
 * - `otp/`: `OtpIssuer` (code, HMAC, `onboarding_otps` row, send) behind the `OtpDelivery` port
 *   (`NotificationsOtpDelivery`: the notifications service's messages API).
 * - `events.ts`: every onboarding event; `rejection.ts`: fail after committing (attempt counts).
 */
@Module({
  controllers: [
    OnboardingCommissionsController,
    IdentifyController,
    OnboardingSessionsController,
    OnboardingCodesController,
  ],
  providers: [
    { provide: Clock, useClass: SystemClock },
    {
      provide: OtpDelivery,
      useFactory: () =>
        new NotificationsOtpDelivery({
          notificationsUrl: config.NOTIFICATIONS_URL,
          tokens: new ServiceTokenClient({
            issuerUrl: config.OIDC_ISSUER_URL,
            clientId: config.KEYCLOAK_CLIENT_ID,
            clientSecret: config.KEYCLOAK_CLIENT_SECRET,
            scopes: [NOTIFICATIONS_MESSAGES_SCOPE],
          }),
        }),
    },
    OnboardingSessions,
    OnboardingCommissionsService,
    IdentifyService,
    IdentifyFailureCounter,
    OtpIssuer,
    OnboardingSessionSweeper,
    OnboardingCodesService,
  ],
})
export class OnboardingModule {}
