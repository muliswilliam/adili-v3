import { Injectable } from '@nestjs/common';
import { ProblemException } from '@adili/api-kit';
import { and, eq } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import { config } from '../../config.js';
import { commissionOfSession } from '../commissions/onboarding-commission.js';
import { sessionContactChanges, writeBackDeclarantContact } from '../contacts.js';
import { OnboardingFailures } from '../failures/onboarding-failures.js';
import { otpCodeMatches } from '../otp/otp-codes.js';
import { OtpIssuer } from '../otp/otp-issuer.js';
import { reject } from '../rejection.js';
import type { OnboardingSession, ProvideOnboardingContactBody } from '../representation.js';
import { onboardingOtps } from '../schema.js';
import {
  contactRequiredChannel,
  ONBOARDING_TIMING,
  type OtpChannel,
  pendingChannel,
} from '../session-state.js';
import {
  OnboardingSessions,
  sessionEnded,
  type SessionContext,
  type SessionRow,
  wrongStep,
} from '../sessions.repository.js';

type OtpRow = typeof onboardingOtps.$inferSelect;

/**
 * Codes and contacts (spec 03, steps 3 and 4): verifying a channel's one-time code, sending a
 * new one, and supplying a contact the roster record lacks. Email first, then phone.
 *
 * - Verify: the session must wait for that channel's code (else 409 `wrong-step`). A code past
 *   its 10 minutes: 400 `otp-expired`, not counted. A wrong code: 400 `otp-invalid` with
 *   `attemptsLeft`; the 5th wrong code ends the session (outcome `rate-limited`, 410). The right
 *   code verifies the contact, writes a declarant-supplied one back to the roster record (source
 *   `declarant`), and moves on: after email to the phone (its code sent at once, or
 *   `phone-contact-required`), after phone to `phone-verified` (the confirm step).
 * - Resend: 429 `resend-cooldown` within 60 seconds of the last code; a 4th resend of a channel
 *   ends the session (outcome `rate-limited`, 410); otherwise a new code replaces the old one.
 * - Contact: only in the channel's `*-contact-required` state; kept on the session (source
 *   `declarant`) and its first code sent.
 *
 * A session that runs out of codes or resends counts as a failed attempt against its Commission
 * (`OnboardingFailures`), as a no-match at identify does. A code that cannot be sent answers 502
 * `otp-send-failed` and changes nothing (it is sent before the step commits:
 * `OtpIssuer.sending`), so the declarant can simply try again.
 */
@Injectable()
export class OnboardingCodesService {
  constructor(
    private readonly sessions: OnboardingSessions,
    private readonly otp: OtpIssuer,
    private readonly failures: OnboardingFailures,
  ) {}

  verify(
    sessionId: string,
    secret: string | undefined,
    channel: OtpChannel,
    code: string,
  ): Promise<OnboardingSession> {
    return this.otp.sending((issue) =>
      this.sessions.withLiveSession(sessionId, secret, async (context) => {
        const { tx, session, now } = context;
        if (pendingChannel(session.state) !== channel) throw wrongStep();
        const otp = await currentOtp(tx, session, channel);
        if (otp.expiresAt.getTime() <= now.getTime()) {
          throw ProblemException.fromCode('otp-expired');
        }

        if (!otpCodeMatches(config.ONBOARDING_HMAC_KEY, session.id, channel, code, otp.codeHmac)) {
          const attempts = otp.attempts + 1;
          await tx
            .update(onboardingOtps)
            .set({ attempts })
            .where(
              and(eq(onboardingOtps.sessionId, session.id), eq(onboardingOtps.channel, channel)),
            );
          const attemptsLeft = ONBOARDING_TIMING.otpAttempts - attempts;
          if (attemptsLeft <= 0) return this.exhausted(context);
          return reject(ProblemException.fromCode('otp-invalid', { extensions: { attemptsLeft } }));
        }

        await tx
          .update(onboardingOtps)
          .set({ verifiedAt: now })
          .where(
            and(eq(onboardingOtps.sessionId, session.id), eq(onboardingOtps.channel, channel)),
          );
        const verifiedState = channel === 'email' ? 'email-verified' : 'phone-verified';
        let current = await this.sessions.transition(tx, session, verifiedState, now, {
          set: sessionContactChanges(channel, { verifiedAt: now }),
        });
        await writeBackDeclarantContact(tx, current, channel, now);

        if (channel === 'email') {
          if (current.phone) {
            const commission = await commissionOfSession(tx, session);
            await issue(tx, current, 'phone', { commissionName: commission.name, now });
            current = await this.sessions.transition(tx, current, 'phone-pending', now, {
              extend: false,
            });
          } else {
            current = await this.sessions.transition(tx, current, 'phone-contact-required', now, {
              extend: false,
            });
          }
        }
        return this.sessions.view(tx, current, now);
      }),
    );
  }

  resend(sessionId: string, secret: string | undefined, channel: OtpChannel): Promise<void> {
    return this.otp.sending((issue) =>
      this.sessions.withLiveSession(sessionId, secret, async (context) => {
        const { tx, session, now } = context;
        if (pendingChannel(session.state) !== channel) throw wrongStep();
        const otp = await currentOtp(tx, session, channel);
        const waitMs =
          otp.lastSentAt.getTime() + ONBOARDING_TIMING.resendCooldownMs - now.getTime();
        if (waitMs > 0) {
          throw ProblemException.fromCode('resend-cooldown', {
            extensions: { retryAfterSeconds: Math.ceil(waitMs / 1000) },
          });
        }
        if (otp.resends >= ONBOARDING_TIMING.otpResends) return this.exhausted(context);
        const commission = await commissionOfSession(tx, session);
        await issue(tx, session, channel, {
          resend: true,
          commissionName: commission.name,
          now,
        });
      }),
    );
  }

  provideContact(
    sessionId: string,
    secret: string | undefined,
    { channel, value }: ProvideOnboardingContactBody,
  ): Promise<OnboardingSession> {
    return this.otp.sending((issue) =>
      this.sessions.withLiveSession(sessionId, secret, async ({ tx, session, now }) => {
        if (contactRequiredChannel(session.state) !== channel) throw wrongStep();
        const pending = await this.sessions.transition(
          tx,
          session,
          channel === 'email' ? 'email-pending' : 'phone-pending',
          now,
          { set: sessionContactChanges(channel, { value, source: 'declarant' }) },
        );
        const commission = await commissionOfSession(tx, session);
        await issue(tx, pending, channel, { commissionName: commission.name, now });
        return this.sessions.view(tx, pending, now);
      }),
    );
  }

  /**
   * Codes or resends ran out: the session ends (outcome `rate-limited`), counted as a failed
   * attempt against the Commission, and the declarant is told it ended (410).
   */
  private async exhausted({ tx, session, now }: SessionContext) {
    await this.sessions.end(tx, session, 'rate-limited', now);
    await this.failures.record(tx, session.tenant, now);
    return reject(sessionEnded());
  }
}

/** The channel's current code; a session waiting for one always has it. */
async function currentOtp(tx: Transaction, session: SessionRow, channel: OtpChannel) {
  const [otp]: OtpRow[] = await tx
    .select()
    .from(onboardingOtps)
    .where(and(eq(onboardingOtps.sessionId, session.id), eq(onboardingOtps.channel, channel)));
  if (!otp) throw new Error(`Session ${session.id} waits for a ${channel} code it has not got`);
  return otp;
}
