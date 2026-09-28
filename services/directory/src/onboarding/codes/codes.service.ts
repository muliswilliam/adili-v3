import { Injectable } from '@nestjs/common';
import { ProblemException } from '@adili/api-kit';
import { and, eq, isNull, or } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import { commissions } from '../../commissions/schema.js';
import { config } from '../../config.js';
import { rosterRecords } from '../../roster/schema.js';
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
 * A code that cannot be sent answers 502 `otp-send-failed` and changes nothing (the step's
 * transaction rolls back), so the declarant can simply try again.
 */
@Injectable()
export class OnboardingCodesService {
  constructor(
    private readonly sessions: OnboardingSessions,
    private readonly otp: OtpIssuer,
  ) {}

  verify(
    sessionId: string,
    secret: string | undefined,
    channel: OtpChannel,
    code: string,
  ): Promise<OnboardingSession> {
    return this.sessions.withLiveSession(sessionId, secret, async ({ tx, session, now }) => {
      if (pendingChannel(session.state) !== channel) throw wrongStep();
      const otp = await currentOtp(tx, session, channel);
      if (otp.expiresAt.getTime() <= now.getTime()) throw ProblemException.fromCode('otp-expired');

      if (!otpCodeMatches(config.ONBOARDING_HMAC_KEY, session.id, channel, code, otp.codeHmac)) {
        const attempts = otp.attempts + 1;
        await tx
          .update(onboardingOtps)
          .set({ attempts })
          .where(
            and(eq(onboardingOtps.sessionId, session.id), eq(onboardingOtps.channel, channel)),
          );
        const attemptsLeft = ONBOARDING_TIMING.otpAttempts - attempts;
        if (attemptsLeft <= 0) {
          await this.sessions.end(tx, session, 'rate-limited', now);
          return reject(sessionEnded());
        }
        return reject(ProblemException.fromCode('otp-invalid', { extensions: { attemptsLeft } }));
      }

      await tx
        .update(onboardingOtps)
        .set({ verifiedAt: now })
        .where(and(eq(onboardingOtps.sessionId, session.id), eq(onboardingOtps.channel, channel)));
      await writeBackContact(tx, session, channel, now);

      let current: SessionRow;
      if (channel === 'email') {
        current = await this.sessions.transition(tx, session, 'email-verified', now, {
          set: { emailVerifiedAt: now },
        });
        if (current.phone) {
          await this.otp.issue(tx, current, 'phone', {
            commissionName: await commissionName(tx, session),
            now,
          });
          current = await this.sessions.transition(tx, current, 'phone-pending', now, {
            extend: false,
          });
        } else {
          current = await this.sessions.transition(tx, current, 'phone-contact-required', now, {
            extend: false,
          });
        }
      } else {
        current = await this.sessions.transition(tx, session, 'phone-verified', now, {
          set: { phoneVerifiedAt: now },
        });
      }
      return this.sessions.view(tx, current, now);
    });
  }

  resend(sessionId: string, secret: string | undefined, channel: OtpChannel): Promise<void> {
    return this.sessions.withLiveSession(sessionId, secret, async ({ tx, session, now }) => {
      if (pendingChannel(session.state) !== channel) throw wrongStep();
      const otp = await currentOtp(tx, session, channel);
      const waitMs = otp.lastSentAt.getTime() + ONBOARDING_TIMING.resendCooldownMs - now.getTime();
      if (waitMs > 0) {
        throw ProblemException.fromCode('resend-cooldown', {
          extensions: { retryAfterSeconds: Math.ceil(waitMs / 1000) },
        });
      }
      if (otp.resends >= ONBOARDING_TIMING.otpResends) {
        await this.sessions.end(tx, session, 'rate-limited', now);
        return reject(sessionEnded());
      }
      await this.otp.issue(tx, session, channel, {
        resend: true,
        commissionName: await commissionName(tx, session),
        now,
      });
    });
  }

  provideContact(
    sessionId: string,
    secret: string | undefined,
    { channel, value }: ProvideOnboardingContactBody,
  ): Promise<OnboardingSession> {
    return this.sessions.withLiveSession(sessionId, secret, async ({ tx, session, now }) => {
      if (contactRequiredChannel(session.state) !== channel) throw wrongStep();
      const contact =
        channel === 'email'
          ? { email: value, emailSource: 'declarant' as const }
          : { phone: value, phoneSource: 'declarant' as const };
      const pending = await this.sessions.transition(
        tx,
        session,
        channel === 'email' ? 'email-pending' : 'phone-pending',
        now,
        { set: contact },
      );
      await this.otp.issue(tx, pending, channel, {
        commissionName: await commissionName(tx, session),
        now,
      });
      return this.sessions.view(tx, pending, now);
    });
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

async function commissionName(tx: Transaction, session: SessionRow): Promise<string> {
  const [commission] = await tx
    .select({ name: commissions.name })
    .from(commissions)
    .where(eq(commissions.slug, session.tenant));
  if (!commission) throw new Error(`Commission ${session.tenant} of session ${session.id} is gone`);
  return commission.name;
}

/**
 * Writes a contact the declarant supplied, now verified, to the roster record with source
 * `declarant`, so later notifications reach them (spec 03, S9). Only where the record still has
 * no contact of its own for the channel: roster contacts are not editable in this flow, and one
 * an import added meanwhile stays.
 */
async function writeBackContact(
  tx: Transaction,
  session: SessionRow,
  channel: OtpChannel,
  now: Date,
): Promise<void> {
  if (channel === 'email') {
    if (session.emailSource !== 'declarant' || session.email === null) return;
    await tx
      .update(rosterRecords)
      .set({ email: session.email, emailSource: 'declarant', updatedAt: now })
      .where(
        and(
          eq(rosterRecords.id, session.rosterRecordId),
          or(isNull(rosterRecords.email), eq(rosterRecords.emailSource, 'declarant')),
        ),
      );
    return;
  }
  if (session.phoneSource !== 'declarant' || session.phone === null) return;
  await tx
    .update(rosterRecords)
    .set({ phone: session.phone, phoneSource: 'declarant', updatedAt: now })
    .where(
      and(
        eq(rosterRecords.id, session.rosterRecordId),
        or(isNull(rosterRecords.phone), eq(rosterRecords.phoneSource, 'declarant')),
      ),
    );
}
