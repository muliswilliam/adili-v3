import { Injectable } from '@nestjs/common';
import { ProblemException, RateLimiter } from '@adili/api-kit';
import type { ContactChannel } from '@adili/contacts';
import { and, eq } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import { config } from '../../config.js';
import { CHANNELS, contactRequiredChannel, pendingChannel } from '../channels.js';
import { commissionOfSession } from '../commissions/onboarding-commission.js';
import { sessionContact, sessionContactChanges, writeBackDeclarantContact } from '../contacts.js';
import { OnboardingFailures } from '../failures/onboarding-failures.js';
import { otpCodeMatches } from '../otp/otp-codes.js';
import { OtpIssuer } from '../otp/otp-issuer.js';
import { IDENTIFY_RATE_LIMIT, type SessionCredentials } from '../public-route.js';
import { reject } from '../rejection.js';
import type { OnboardingSession, ProvideOnboardingContactBody } from '../representation.js';
import { onboardingOtps } from '../schema.js';
import { ONBOARDING_TIMING } from '../session-state.js';
import {
  OnboardingSessions,
  refuseDuringCooldown,
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
 * (`OnboardingFailures`), as a no-match at identify does, and, once it has ended, uses up an
 * identify attempt of the client IP (the spec's "the counter feeds the rate limits"), so running
 * out of codes and starting again cannot go on at more than identify's own pace per IP.
 * A code that cannot be sent answers 502
 * `otp-send-failed` and changes nothing (it is sent before the step commits:
 * `OtpIssuer.sending`), so the declarant can simply try again.
 */
@Injectable()
export class OnboardingCodesService {
  constructor(
    private readonly sessions: OnboardingSessions,
    private readonly otp: OtpIssuer,
    private readonly failures: OnboardingFailures,
    private readonly limiter: RateLimiter,
  ) {}

  verify(
    credentials: SessionCredentials,
    channel: ContactChannel,
    code: string,
    clientKey: string | undefined,
  ): Promise<OnboardingSession> {
    return this.chargingExhaustion(clientKey, () =>
      this.otp.sending((issue) =>
        this.sessions.withLiveSession(credentials, async (context) => {
          const { tx, session, now } = context;
          if (pendingChannel(session.state) !== channel) throw wrongStep();
          const otp = await currentOtp(tx, session, channel);
          if (otp.expiresAt.getTime() <= now.getTime()) {
            throw ProblemException.fromCode('otp-expired');
          }

          if (
            !otpCodeMatches(config.ONBOARDING_HMAC_KEY, session.id, channel, code, otp.codeHmac)
          ) {
            const attempts = otp.attempts + 1;
            await tx
              .update(onboardingOtps)
              .set({ attempts })
              .where(
                and(eq(onboardingOtps.sessionId, session.id), eq(onboardingOtps.channel, channel)),
              );
            const attemptsLeft = ONBOARDING_TIMING.otpAttempts - attempts;
            if (attemptsLeft <= 0) return this.exhausted(context);
            return reject(
              ProblemException.fromCode('otp-invalid', { extensions: { attemptsLeft } }),
            );
          }

          await tx
            .update(onboardingOtps)
            .set({ verifiedAt: now })
            .where(
              and(eq(onboardingOtps.sessionId, session.id), eq(onboardingOtps.channel, channel)),
            );
          let current = await this.sessions.transition(
            tx,
            session,
            CHANNELS[channel].states.verified,
            now,
            { set: sessionContactChanges(channel, { verifiedAt: now }) },
          );
          await writeBackDeclarantContact(tx, current, channel, now);

          const next = CHANNELS[channel].next;
          if (next !== null) {
            if (sessionContact(current, next).value !== null) {
              const commission = await commissionOfSession(tx, session);
              await issue(tx, current, next, { commissionName: commission.name, now });
              current = await this.sessions.transition(
                tx,
                current,
                CHANNELS[next].states.pending,
                now,
                { extend: false },
              );
            } else {
              current = await this.sessions.transition(
                tx,
                current,
                CHANNELS[next].states.contactRequired,
                now,
                { extend: false },
              );
            }
          }
          return this.sessions.view(tx, current, now);
        }),
      ),
    );
  }

  resend(
    credentials: SessionCredentials,
    channel: ContactChannel,
    clientKey: string | undefined,
  ): Promise<void> {
    return this.chargingExhaustion(clientKey, () =>
      this.otp.sending((issue) =>
        this.sessions.withLiveSession(credentials, async (context) => {
          const { tx, session, now } = context;
          if (pendingChannel(session.state) !== channel) throw wrongStep();
          const otp = await currentOtp(tx, session, channel);
          refuseDuringCooldown(otp.lastSentAt, now);
          if (otp.resends >= ONBOARDING_TIMING.otpResends) return this.exhausted(context);
          const commission = await commissionOfSession(tx, session);
          await issue(tx, session, channel, {
            resend: true,
            commissionName: commission.name,
            now,
          });
        }),
      ),
    );
  }

  provideContact(
    credentials: SessionCredentials,
    { channel, value }: ProvideOnboardingContactBody,
  ): Promise<OnboardingSession> {
    return this.otp.sending((issue) =>
      this.sessions.withLiveSession(credentials, async ({ tx, session, now }) => {
        if (contactRequiredChannel(session.state) !== channel) throw wrongStep();
        const pending = await this.sessions.transition(
          tx,
          session,
          CHANNELS[channel].states.pending,
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
    const ended = sessionEnded();
    RATE_LIMITED_ENDINGS.add(ended);
    return reject(ended);
  }

  /**
   * Runs a code step; should it end the session for running out of codes or resends, charges an
   * identify attempt to the client (`clientKey`, as `byClientIp` keys identify's budget) once the
   * ending has committed. Past that budget the charge is simply refused: the next identify is.
   */
  private async chargingExhaustion<T>(
    clientKey: string | undefined,
    step: () => Promise<T>,
  ): Promise<T> {
    try {
      return await step();
    } catch (error) {
      if (
        clientKey !== undefined &&
        error instanceof ProblemException &&
        RATE_LIMITED_ENDINGS.has(error)
      ) {
        await this.limiter.consume(IDENTIFY_RATE_LIMIT, clientKey);
      }
      throw error;
    }
  }
}

/** The 410s of sessions that ran out of codes or resends (`exhausted`), not of time. */
const RATE_LIMITED_ENDINGS = new WeakSet<ProblemException>();

/** The channel's current code; a session waiting for one always has it. */
async function currentOtp(tx: Transaction, session: SessionRow, channel: ContactChannel) {
  const [otp]: OtpRow[] = await tx
    .select()
    .from(onboardingOtps)
    .where(and(eq(onboardingOtps.sessionId, session.id), eq(onboardingOtps.channel, channel)));
  if (!otp) throw new Error(`Session ${session.id} waits for a ${channel} code it has not got`);
  return otp;
}
