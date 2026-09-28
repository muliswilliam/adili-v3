import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { errorType, ProblemException } from '@adili/api-kit';
import { sql } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import { config } from '../../config.js';
import { onboardingOtps } from '../schema.js';
import { ONBOARDING_TIMING, type OtpChannel } from '../session-state.js';
import type { SessionRow } from '../sessions.repository.js';
import { generateOtpCode, otpCodeHmac } from './otp-codes.js';
import { OtpDelivery, OtpDeliveryFailed } from './otp-delivery.js';

export interface IssueOptions {
  /** A resend: counts against the channel's resends. The first code of a channel is not one. */
  resend?: boolean;
  /** The Commission named in the message. */
  commissionName: string;
  now: Date;
}

/**
 * Issues a channel's one-time code (spec 03, OTP): a fresh 6-digit code whose HMAC replaces the
 * channel's previous one (so an older code stops working), with a new expiry, no wrong attempts
 * and the send time for the resend cooldown; then sends it to the session's contact for the
 * channel. Runs in the step's transaction: when the send fails it throws 502 problem details and
 * the transaction rolls back, leaving the session as it was.
 *
 * Callers check the step rules first (state, cooldown, resends left); this only issues.
 */
@Injectable()
export class OtpIssuer {
  private readonly logger = new Logger(OtpIssuer.name);

  constructor(private readonly delivery: OtpDelivery) {}

  async issue(
    tx: Transaction,
    session: SessionRow,
    channel: OtpChannel,
    { resend = false, commissionName, now }: IssueOptions,
  ): Promise<void> {
    const to = channel === 'email' ? session.email : session.phone;
    if (!to) throw new Error(`Session ${session.id} has no ${channel} to send a code to`);

    const code = generateOtpCode();
    const values = {
      sessionId: session.id,
      channel,
      tenant: session.tenant,
      codeHmac: otpCodeHmac(config.ONBOARDING_HMAC_KEY, session.id, channel, code),
      expiresAt: new Date(now.getTime() + ONBOARDING_TIMING.otpTtlMs),
      attempts: 0,
      resends: 0,
      lastSentAt: now,
      verifiedAt: null,
    };
    await tx
      .insert(onboardingOtps)
      .values(values)
      .onConflictDoUpdate({
        target: [onboardingOtps.sessionId, onboardingOtps.channel],
        set: {
          codeHmac: values.codeHmac,
          expiresAt: values.expiresAt,
          attempts: 0,
          resends: resend ? sql`${onboardingOtps.resends} + 1` : onboardingOtps.resends,
          lastSentAt: now,
          verifiedAt: null,
        },
      });

    try {
      await this.delivery.send({
        channel,
        to,
        code,
        commissionName,
        expiresInMinutes: ONBOARDING_TIMING.otpTtlMs / 60_000,
        tenant: session.tenant,
      });
    } catch (error) {
      if (!(error instanceof OtpDeliveryFailed)) throw error;
      this.logger.warn(
        { sessionId: session.id, channel, err: errorType(error) },
        'Onboarding code not sent',
      );
      throw otpNotSent();
    }
  }
}

/**
 * 502 when a code could not be sent. The registry has no code for it: the portal reads a 502
 * without `identity-unavailable` as "could not send".
 */
export function otpNotSent(): ProblemException {
  return new ProblemException({
    type: 'otp-not-sent',
    title: 'Code not sent',
    status: HttpStatus.BAD_GATEWAY,
    detail: 'The one-time code could not be sent; nothing changed. Try again.',
  });
}
