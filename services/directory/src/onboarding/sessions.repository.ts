import { HttpStatus, Injectable } from '@nestjs/common';
import { ProblemException, PLATFORM_TENANT } from '@adili/api-kit';
import { type Database, InjectDatabase, switchTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { type ContactChannel, maskContact } from '@adili/contacts';
import { and, eq } from 'drizzle-orm';

import { Clock } from '../clock.js';
import type { Transaction } from '../commissions/commissions.service.js';
import type { DirectorySchema } from '../db/schema.js';
import { persons } from '../persons/schema.js';
import { reportingEntities, rosterRecords } from '../roster/schema.js';
import { pendingChannel } from './channels.js';
import { commissionOfSession } from './commissions/onboarding-commission.js';
import { sessionContact } from './contacts.js';
import {
  onboardingSessionAdvanced,
  onboardingSessionEnded,
  onboardingSessionStarted,
} from './events.js';
import type { SessionCredentials } from './public-route.js';
import { reject, type Rejection, unwrap } from './rejection.js';
import type { OnboardingSession } from './representation.js';
import { onboardingOtps, onboardingSessions } from './schema.js';
import { hashSessionSecret, newSessionSecret, secretMatches } from './secret.js';
import {
  canTransition,
  type EndReason,
  extendedExpiry,
  hasExpired,
  initialExpiry,
  isTerminal,
  ONBOARDING_TIMING,
  type OnboardingState,
  resendAvailableAt,
  setPasswordEmailStatus,
  showsDetails,
  type TerminalState,
} from './session-state.js';

export type SessionRow = typeof onboardingSessions.$inferSelect;
type SessionChanges = Partial<
  Omit<typeof onboardingSessions.$inferInsert, 'id' | 'tenant' | 'rosterRecordId' | 'state'>
>;

/** `app.subject` of the public onboarding routes' transactions: a system actor, no user. */
export const ONBOARDING_SUBJECT = 'onboarding';

export interface NewSession {
  tenant: string;
  rosterRecordId: string;
  email: string | null;
  phone: string | null;
  clientIpHash: string | null;
}

/** What a step's work gets: the locked live session, its transaction and the step's time. */
export interface SessionContext {
  tx: Transaction;
  session: SessionRow;
  now: Date;
}

/**
 * The onboarding session store and state machine, the one way steps read and change sessions
 * (spec 03). Every state change goes through `transition` or `end`, which check the move against
 * `session-state.ts`, move the expiry and record the audit event in the same transaction.
 *
 * Steps (identify, codes, contacts, confirm, ...) run their work in `withLiveSession`, which
 * answers 404 for an unknown session or a wrong secret, and 410 `session-expired` for one that
 * ended or ran out of time.
 */
@Injectable()
export class OnboardingSessions {
  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * Runs `work` on the session `sessionId` if `secret` is its secret and it is live, in one
   * transaction scoped to the session's Commission, with the session row locked (steps on one
   * session run one at a time). A terminal session (`confirmed`, `identity-mismatch`) is live
   * until its expiry, so the steps after confirm can read it.
   *
   * - Unknown id, malformed id, missing or wrong secret: 404, the same for all.
   * - Ended (`expired`) or past `expiresAt`: 410 `session-expired`; a session that ran out of time
   *   is ended here (`expired`, event outcome `expired`) if the sweep has not done it yet.
   *
   * `work` may return `reject(error)` to commit what it wrote and then fail with `error`.
   */
  async withLiveSession<T>(
    { sessionId, secret }: SessionCredentials,
    work: (context: SessionContext) => Promise<T | Rejection>,
  ): Promise<T> {
    if (!UUID.test(sessionId) || !secret) throw sessionNotFound();
    const now = this.clock.now();
    const result = await this.db.transaction(async (tx) => {
      await switchTenant(tx, { tenant: PLATFORM_TENANT, subject: ONBOARDING_SUBJECT });
      const [session] = await tx
        .select()
        .from(onboardingSessions)
        .where(eq(onboardingSessions.id, sessionId))
        .for('update');
      if (!session || !secretMatches(secret, session.secretHash)) return reject(sessionNotFound());
      await switchTenant(tx, { tenant: session.tenant, subject: ONBOARDING_SUBJECT });
      if (hasExpired(session, now)) {
        if (!isTerminal(session.state)) await this.end(tx, session, 'expired', now);
        return reject(sessionEnded());
      }
      return work({ tx, session, now });
    });
    return unwrap(result);
  }

  /**
   * Starts a session for a matched roster record (state `identified`) in the caller's
   * transaction, scoped to the record's Commission. Returns it with its secret, which is never
   * stored and must reach the caller once.
   */
  async create(
    tx: Transaction,
    values: NewSession,
    now: Date,
  ): Promise<{ session: SessionRow; secret: string }> {
    const secret = newSessionSecret();
    const [session] = await tx
      .insert(onboardingSessions)
      .values({
        tenant: values.tenant,
        rosterRecordId: values.rosterRecordId,
        secretHash: hashSessionSecret(secret),
        state: 'identified',
        email: values.email,
        emailSource: values.email === null ? null : 'roster',
        phone: values.phone,
        phoneSource: values.phone === null ? null : 'roster',
        clientIpHash: values.clientIpHash,
        expiresAt: initialExpiry(now),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!session) throw new Error('insert returned no row');
    await this.events.record(
      tx,
      onboardingSessionStarted(session.tenant, {
        sessionId: session.id,
        rosterRecordId: session.rosterRecordId,
      }),
    );
    return { session, secret };
  }

  /**
   * Moves a live session to its next live state (409 if the state machine does not allow it),
   * with any other column changes, and records `onboarding.session.advanced.v1`. `extend` moves
   * the expiry on by a successful step's extension (capped); the first move after identify does
   * not extend.
   */
  async transition(
    tx: Transaction,
    session: SessionRow,
    to: Exclude<OnboardingState, TerminalState>,
    now: Date,
    { extend = true, set = {} }: { extend?: boolean; set?: SessionChanges } = {},
  ): Promise<SessionRow> {
    if (!canTransition(session.state, to)) throw wrongStep();
    const updated = await this.update(tx, session, {
      ...set,
      state: to,
      ...(extend ? { expiresAt: extendedExpiry(session) } : {}),
      updatedAt: now,
    });
    await this.events.record(
      tx,
      onboardingSessionAdvanced(session.tenant, {
        sessionId: session.id,
        from: session.state,
        state: to,
      }),
    );
    return updated;
  }

  /**
   * Ends a live session: `confirmed` or `identity-mismatch` from confirm, `expired` when time,
   * codes or resends ran out (`reason` says which). Records `onboarding.session.ended.v1`.
   */
  async end(
    tx: Transaction,
    session: SessionRow,
    reason: EndReason,
    now: Date,
    set: SessionChanges = {},
  ): Promise<SessionRow> {
    const state: TerminalState =
      reason === 'confirmed' || reason === 'identity-mismatch' ? reason : 'expired';
    if (!canTransition(session.state, state)) throw wrongStep();
    const updated = await this.update(tx, session, {
      ...set,
      state,
      endReason: reason,
      completedAt: now,
      updatedAt: now,
    });
    await this.events.record(
      tx,
      onboardingSessionEnded(session.tenant, { sessionId: session.id, outcome: reason }),
    );
    return updated;
  }

  /**
   * Changes a session's columns without moving its state or recording an event, e.g. when the
   * set-password email of a confirmed session was sent again.
   */
  async amend(tx: Transaction, session: SessionRow, set: SessionChanges): Promise<SessionRow> {
    return this.update(tx, session, { ...set, state: session.state });
  }

  /** The session as the contract shows it: masked contacts, roster details once due. */
  async view(tx: Transaction, session: SessionRow, now: Date): Promise<OnboardingSession> {
    const commission = await commissionOfSession(tx, session);
    const channel = pendingChannel(session.state);
    const [otp] = channel
      ? await tx
          .select()
          .from(onboardingOtps)
          .where(and(eq(onboardingOtps.sessionId, session.id), eq(onboardingOtps.channel, channel)))
      : [];
    const [person] = session.personId
      ? await tx.select({ ofr: persons.ofr }).from(persons).where(eq(persons.id, session.personId))
      : [];

    return {
      id: session.id,
      state: session.state,
      commission,
      contacts: {
        email: contactView(session, 'email'),
        phone: contactView(session, 'phone'),
      },
      details: showsDetails(session.state) ? await this.details(tx, session) : null,
      otp: channel
        ? {
            channel,
            resendAvailableAt: otp
              ? new Date(
                  Math.max(resendAvailableAt(otp.lastSentAt).getTime(), now.getTime()),
                ).toISOString()
              : null,
            resendsLeft: ONBOARDING_TIMING.otpResends - (otp?.resends ?? 0),
            attemptsLeft: ONBOARDING_TIMING.otpAttempts - (otp?.attempts ?? 0),
          }
        : {
            channel: null,
            resendAvailableAt: passwordEmailAvailableAt(session, now),
            resendsLeft: 0,
            attemptsLeft: 0,
          },
      outcome: session.outcome,
      ofr: person?.ofr ?? null,
      setPasswordEmail: setPasswordEmailStatus(session),
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  private async details(tx: Transaction, session: SessionRow) {
    const [record] = await tx
      .select({
        fullName: rosterRecords.fullName,
        personnelFileNumber: rosterRecords.personnelFileNumber,
        designation: rosterRecords.designation,
        reportingEntity: reportingEntities.name,
      })
      .from(rosterRecords)
      .leftJoin(reportingEntities, eq(reportingEntities.id, rosterRecords.reportingEntityId))
      .where(eq(rosterRecords.id, session.rosterRecordId));
    if (!record) throw new Error(`Roster record of session ${session.id} is gone`);
    return record;
  }

  private async update(
    tx: Transaction,
    session: SessionRow,
    changes: SessionChanges & { state: OnboardingState },
  ): Promise<SessionRow> {
    const [updated] = await tx
      .update(onboardingSessions)
      .set(changes)
      .where(eq(onboardingSessions.id, session.id))
      .returning();
    if (!updated) throw new Error(`Session ${session.id} is gone`);
    return updated;
  }
}

/**
 * When the set-password email of a confirmed session with a new account may be sent again: a
 * minute after the last one, or null once it may (and for every other session without a code).
 */
function passwordEmailAvailableAt(session: SessionRow, now: Date): string | null {
  if (session.state !== 'confirmed' || session.passwordEmailSentAt === null) return null;
  const availableAt = resendAvailableAt(session.passwordEmailSentAt);
  return availableAt > now ? availableAt.toISOString() : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function contactView(session: SessionRow, channel: ContactChannel) {
  const { value, source, verifiedAt } = sessionContact(session, channel);
  if (value === null || source === null) return null;
  return { masked: maskContact(channel, value), source, verified: verifiedAt !== null };
}

/** 404 for an unknown session, a malformed id and a missing or wrong secret alike. */
export function sessionNotFound(): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Not Found',
    status: HttpStatus.NOT_FOUND,
    detail: 'No such onboarding session.',
  });
}

/** 410: the session ended or ran out of time; the portal clears its cookie and starts over. */
export function sessionEnded(): ProblemException {
  return ProblemException.fromCode('session-expired');
}

/**
 * 429 `resend-cooldown`, with `retryAfterSeconds`, while the minute after the last send (of a
 * code or the set-password email) is not up.
 */
export function refuseDuringCooldown(lastSentAt: Date | null, now: Date): void {
  if (lastSentAt === null) return;
  const waitMs = resendAvailableAt(lastSentAt).getTime() - now.getTime();
  if (waitMs > 0) {
    throw ProblemException.fromCode('resend-cooldown', {
      extensions: { retryAfterSeconds: Math.ceil(waitMs / 1000) },
    });
  }
}

/** 409 `wrong-step`: the session is not at the step asked for (e.g. another tab moved it on). */
export function wrongStep(): ProblemException {
  return ProblemException.fromCode('wrong-step');
}
