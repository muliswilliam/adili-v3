import { Module } from '@nestjs/common';
import { MESSAGES_SCOPE } from '@adili/roles';

import { Clock, SystemClock } from '../clock.js';
import {
  ApplicantSessionController,
  ApplicantStartController,
} from './applicants/applicants.controller.js';
import { ApplicantCompleteService } from './applicants/complete.service.js';
import { ApplicantStartService } from './applicants/start.service.js';
import { config } from '../config.js';
import { directoryServiceTokens } from '../service-tokens.js';
import { OnboardingCodesController } from './codes/codes.controller.js';
import { OnboardingCodesService } from './codes/codes.service.js';
import { OnboardingCommissionsController } from './commissions/onboarding-commissions.controller.js';
import { OnboardingCommissionsService } from './commissions/onboarding-commissions.service.js';
import { ConfirmController } from './confirm/confirm.controller.js';
import { ConfirmService } from './confirm/confirm.service.js';
import { OnboardingFailuresController } from './failures/failures.controller.js';
import { OnboardingFailures } from './failures/onboarding-failures.js';
import { IdentifyController } from './identify/identify.controller.js';
import { IdentifyService } from './identify/identify.service.js';
import { iprsLookupProvider } from './iprs/iprs-lookup.provider.js';
import { NotificationsOtpDelivery } from './otp/notifications-otp-delivery.js';
import { OtpDelivery } from './otp/otp-delivery.js';
import { OtpIssuer } from './otp/otp-issuer.js';
import { PasswordEmailController } from './password-email/password-email.controller.js';
import { PasswordEmailService } from './password-email/password-email.service.js';
import { OnboardingExpirySchedule } from './sessions/expiry-schedule.js';
import { OnboardingSessionSweeper } from './sessions/expiry-sweep.js';
import { OnboardingSessionsController } from './sessions/sessions.controller.js';
import { OnboardingSessions } from './sessions.repository.js';

/**
 * Onboarding: the public routes under `/v1/onboarding` that turn a roster record into a declarant
 * account (spec 03), and a member of the public into an applicant account (spec 10).
 *
 * - `session-state.ts`: states, allowed moves, timing rules (pure).
 * - `sessions.repository.ts`: `OnboardingSessions`, the only way to read and change a session:
 *   `withLiveSession` (secret check, 404/410, row lock, tenant context), `transition` / `end`
 *   (state machine, expiry, audit events), `view` (the contract's `OnboardingSession`).
 * - One folder per step, each with its own controller under `v1/onboarding/...` using
 *   `@OnboardingController()`, and for session routes `@ApiSessionRoute()`, `@SessionSecret()`
 *   and the `onboarding-session` rate limit (`public-route.ts`): `commissions/`, `identify/`,
 *   `sessions/` (read; the expiry sweep, run by a Temporal schedule on the directory's worker),
 *   `codes/` (verify, resend, contacts), `confirm/` (IPRS check, person and OFR, account
 *   created or linked), `password-email/` (resending the set-password email).
 * - `otp/`: `OtpIssuer` (code, send outside the step's transaction, HMAC in `onboarding_otps`)
 *   behind the `OtpDelivery` port (`NotificationsOtpDelivery`: the notifications service's
 *   messages API).
 * - `failures/`: failed attempts per Commission and hour (`onboarding_failures`), the abuse
 *   threshold event, and the count reporting officers read.
 * - `commissions/onboarding-commission.ts`, `contacts.ts`: the Commission and per-channel contact
 *   helpers every step shares.
 * - `iprs/`: the `IprsLookup` port onto the integration-gateway and the confirm step's name rule.
 * - `applicants/`: applicant onboarding under `v1/onboarding/applicants`, on the same sessions
 *   (kind `applicant`: no Commission, no roster record, the phone's code only): start (IPRS for a
 *   national ID, none for a passport), the code (`codes/`), complete (person and account),
 *   resend-password-email (`password-email/`).
 * - `events.ts`: every onboarding event; `rejection.ts`: fail after committing (attempt counts).
 */
@Module({
  controllers: [
    OnboardingCommissionsController,
    IdentifyController,
    OnboardingSessionsController,
    OnboardingCodesController,
    ConfirmController,
    PasswordEmailController,
    OnboardingFailuresController,
    ApplicantStartController,
    ApplicantSessionController,
  ],
  providers: [
    { provide: Clock, useClass: SystemClock },
    {
      provide: OtpDelivery,
      useFactory: () =>
        new NotificationsOtpDelivery({
          notificationsUrl: config.NOTIFICATIONS_URL,
          tokens: directoryServiceTokens(MESSAGES_SCOPE),
        }),
    },
    OnboardingSessions,
    OnboardingCommissionsService,
    IdentifyService,
    OnboardingFailures,
    OtpIssuer,
    OnboardingSessionSweeper,
    OnboardingExpirySchedule,
    OnboardingCodesService,
    iprsLookupProvider,
    ConfirmService,
    PasswordEmailService,
    ApplicantStartService,
    ApplicantCompleteService,
  ],
  exports: [OnboardingSessionSweeper],
})
export class OnboardingModule {}
