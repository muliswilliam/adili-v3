import { Injectable, Logger } from '@nestjs/common';
import { errorType, ProblemException } from '@adili/api-kit';
import { sql } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import { config } from '../../config.js';
import { sessionContact } from '../contacts.js';
import { onboardingOtps } from '../schema.js';
import { ONBOARDING_TIMING, type OtpChannel } from '../session-state.js';
import type { SessionRow } from '../sessions.repository.js';
import { generateOtpCode, otpCodeHmac } from './otp-codes.js';
import { OtpDelivery, OtpDeliveryFailed, type OtpMessage } from './otp-delivery.js';

export interface IssueOptions {
  /** A resend: counts against the channel's resends. The first code of a channel is not one. */
  resend?: boolean;
  /** The Commission named in the message. */
  commissionName: string;
  now: Date;
}

/**
 * Issues a channel's one-time code from inside a step's transaction: a fresh 6-digit code whose
 * HMAC replaces the channel's previous one (so an older code stops working), with a new expiry,
 * no wrong attempts and the send time for the resend cooldown. Callers check the step rules
 * first (state, cooldown, resends left); this only issues. Given to the step by
 * `OtpIssuer.sending`.
 */
export type IssueCode = (
  tx: Transaction,
  session: SessionRow,
  channel: OtpChannel,
  options: IssueOptions,
) => Promise<void>;

/** Thrown through a step's first run to roll it back once it asked for a code to be sent. */
class SendFirst extends Error {
  constructor() {
    super('A one-time code is sent before the step commits');
    this.name = 'SendFirst';
  }
}

/**
 * One-time codes of onboarding steps (spec 03, OTP), sent through the notifications service
 * without holding a transaction (and the session's row lock, and a pooled connection) open while
 * it answers. See `sending`.
 */
@Injectable()
export class OtpIssuer {
  private readonly logger = new Logger(OtpIssuer.name);

  constructor(private readonly delivery: OtpDelivery) {}

  /**
   * Runs a step that may send a code, in three moves:
   *
   * 1. `step` runs with an `issue` that notes the code to send and throws, rolling the step's
   *    transaction back. A step that sends no code (or refuses first) just runs, once.
   * 2. The code is sent, outside any transaction. When it cannot be, 502 `otp-send-failed`:
   *    nothing changed, the declarant may try again.
   * 3. `step` runs again in a new transaction, re-checking everything under its locks, and its
   *    `issue` stores the code that was sent. Should it now issue a different one (another
   *    request moved the session on meanwhile), 409 `wrong-step` and the sent code stays unused.
   */
  async sending<T>(step: (issue: IssueCode) => Promise<T>): Promise<T> {
    let pending: OtpMessage | undefined;
    try {
      return await step((_tx, session, channel, options) => {
        pending = this.message(session, channel, options, generateOtpCode());
        return Promise.reject(new SendFirst());
      });
    } catch (error) {
      if (!(error instanceof SendFirst) || !pending) throw error;
    }
    const sent = pending;
    await this.deliver(sent);

    let stored = false;
    return step(async (tx, session, channel, options) => {
      const wanted = this.message(session, channel, options, sent.code);
      if (stored || wanted.channel !== sent.channel || wanted.to !== sent.to) {
        throw ProblemException.fromCode('wrong-step');
      }
      stored = true;
      await store(tx, session, channel, sent.code, options);
    });
  }

  private message(
    session: SessionRow,
    channel: OtpChannel,
    { commissionName }: IssueOptions,
    code: string,
  ): OtpMessage {
    const to = sessionContact(session, channel).value;
    if (!to) throw new Error(`Session ${session.id} has no ${channel} to send a code to`);
    return {
      channel,
      to,
      code,
      commissionName,
      expiresInMinutes: ONBOARDING_TIMING.otpTtlMs / 60_000,
      tenant: session.tenant,
    };
  }

  private async deliver(message: OtpMessage): Promise<void> {
    try {
      await this.delivery.send(message);
    } catch (error) {
      if (!(error instanceof OtpDeliveryFailed)) throw error;
      this.logger.warn(
        { tenant: message.tenant, channel: message.channel, err: errorType(error) },
        'Onboarding code not sent',
      );
      throw otpNotSent();
    }
  }
}

/** The channel's current code becomes `code`: its HMAC, expiry, attempts and send time. */
async function store(
  tx: Transaction,
  session: SessionRow,
  channel: OtpChannel,
  code: string,
  { resend = false, now }: IssueOptions,
): Promise<void> {
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
}

/** 502 `otp-send-failed`: the code could not be sent; the step changed nothing. */
export function otpNotSent(): ProblemException {
  return ProblemException.fromCode('otp-send-failed', {
    detail: 'The one-time code could not be sent; nothing changed. Try again.',
  });
}
