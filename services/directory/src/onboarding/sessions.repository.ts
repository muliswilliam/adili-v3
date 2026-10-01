import { HttpStatus, Injectable } from '@nestjs/common';
import { ProblemException, PLATFORM_TENANT } from '@adili/api-kit';
import { type Database, InjectDatabase, switchTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { type ContactChannel, maskContact } from '@adili/contacts';
import { and, eq } from 'drizzle-orm';

import { Clock } from '../clock.js';
import type { Transaction } from '../commissions/commissions.service.js';
import type { DirectorySchema } from '../db/schema.js';
import { type IdentityDocumentKind, persons } from '../persons/schema.js';
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
import type { ApplicantOnboardingSession } from './applicants/representation.js';
import type { OnboardingSession } from './representation.js';
import { onboardingOtps, onboardingSessions } from './schema.js';
import { hashSessionSecret, newSessionSecret, secretMatches } from './secret.js';
import {
  type ApplicantState,
  canTransition,
  type EndReason,
  extendedExpiry,
  hasExpired,
  initialExpiry,
  isTerminal,
  ONBOARDING_TIMING,
  type OnboardingKind,
  type OnboardingState,
  resendAvailableAt,
  setPasswordEmailStatus,
  showsDetails,
  type TerminalState,
} from './session-state.js';

export type SessionRow = typeof onboardingSessions.$inferSelect;
type SessionChanges = Partial<
  Omit<
    typeof onboardingSessions.$inferInsert,
    'id' | 'kind' | 'tenant' | 'rosterRecordId' | 'state'
  >
>;

/** A declarant's session: for one roster record of one Commission. */
export type DeclarantSessionRow = SessionRow & {
  kind: 'declarant';
  tenant: string;
  rosterRecordId: string;
};

/** An applicant's session: no Commission, no roster record, what the applicant entered. */
export type ApplicantSessionRow = SessionRow & {
  kind: 'applicant';
  tenant: null;
  rosterRecordId: null;
  state: ApplicantState;
  documentKind: IdentityDocumentKind;
  documentNumber: string;
  surname: string;
  firstName: string;
};

/** The session as a declarant's; the table's check constraint keeps its columns so. */
export function asDeclarant(session: SessionRow): DeclarantSessionRow {
  if (session.kind !== 'declarant' || session.tenant === null || session.rosterRecordId === null) {
    throw new Error(`Session ${session.id} is not a declarant's`);
  }
  return session as DeclarantSessionRow;
}

/** The session as an applicant's; the table's check constraint keeps its columns so. */
export function asApplicant(session: SessionRow): ApplicantSessionRow {
  if (
    session.kind !== 'applicant' ||
    session.documentKind === null ||
    session.documentNumber === null ||
    session.surname === null ||
    session.firstName === null
  ) {
    throw new Error(`Session ${session.id} is not an applicant's`);
  }
  return session as ApplicantSessionRow;
}

/** `app.subject` of the public onboarding routes' transactions: a system actor, no user. */
export const ONBOARDING_SUBJECT = 'onboarding';

export interface NewSession {
  tenant: string;
  rosterRecordId: string;
  email: string | null;
  phone: string | null;
  clientIpHash: string | null;
}

/** What an applicant entered at start, normalised. */
export interface NewApplicantSession {
  documentKind: IdentityDocumentKind;
  documentNumber: string;
  /** A passport's issuing country; null for a national ID. */
  documentCountry: string | null;
  surname: string;
  firstName: string;
  otherNames: string | null;
  email: string;
  /** E.164. */
  phone: string;
  clientIpHash: string | null;
}

/** What a step's work gets: the locked live session, its transaction and the step's time. */
export interface SessionContext<S extends SessionRow = SessionRow> {
  tx: Transaction;
  session: S;
  now: Date;
}

/**
 * The onboarding session store and state machine, the one way steps read and change sessions
 * (spec 03, and applicants' in spec 10). Every state change goes through `transition` or `end`,
 * which check the move against `session-state.ts` for the session's kind, move the expiry and
 * record the audit event in the same transaction.
 *
 * Steps (identify, codes, contacts, confirm, ...) run their work in `withLiveSession` (a
 * declarant's session) or `withLiveApplicantSession`, which answer 404 for an unknown session, a
 * wrong secret or a session of the other kind, and 410 `session-expired` for one that ended or
 * ran out of time.
 */
@Injectable()
export class OnboardingSessions {
  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * Runs `work` on the declarant's session `sessionId` if `secret` is its secret and it is live,
   * in one transaction scoped to the session's Commission, with the session row locked (steps on
   * one session run one at a time). A terminal session (`confirmed`, `identity-mismatch`) is live
   * until its expiry, so the steps after confirm can read it.
   *
   * - Unknown id, malformed id, missing or wrong secret, an applicant's session: 404, the same for
   *   all.
   * - Ended (`expired`) or past `expiresAt`: 410 `session-expired`; a session that ran out of time
   *   is ended here (`expired`, event outcome `expired`) if the sweep has not done it yet.
   *
   * `work` may return `reject(error)` to commit what it wrote and then fail with `error`.
   */
  withLiveSession<T>(
    credentials: SessionCredentials,
    work: (context: SessionContext<DeclarantSessionRow>) => Promise<T | Rejection>,
  ): Promise<T> {
    return this.withLiveSessionOf('declarant', credentials, ({ tx, session, now }) =>
      work({ tx, session: asDeclarant(session), now }),
    );
  }

  /**
   * `withLiveSession` for an applicant's session (spec 10): the same answers, 404 for a
   * declarant's session, and the transaction stays in the `platform` context (the session has no
   * tenant).
   */
  withLiveApplicantSession<T>(
    credentials: SessionCredentials,
    work: (context: SessionContext<ApplicantSessionRow>) => Promise<T | Rejection>,
  ): Promise<T> {
    return this.withLiveSessionOf('applicant', credentials, ({ tx, session, now }) =>
      work({ tx, session: asApplicant(session), now }),
    );
  }

  /** `withLiveSession` for a session of `kind`, for the steps both kinds share (codes). */
  async withLiveSessionOf<T>(
    kind: OnboardingKind,
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
      if (session?.kind !== kind || !secretMatches(secret, session.secretHash)) {
        return reject(sessionNotFound());
      }
      if (session.tenant !== null) {
        await switchTenant(tx, { tenant: session.tenant, subject: ONBOARDING_SUBJECT });
      }
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
  ): Promise<{ session: DeclarantSessionRow; secret: string }> {
    const secret = newSessionSecret();
    const [session] = await tx
      .insert(onboardingSessions)
      .values({
        kind: 'declarant',
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
    const created = asDeclarant(session);
    await this.events.record(
      tx,
      onboardingSessionStarted(created.tenant, {
        sessionId: created.id,
        rosterRecordId: created.rosterRecordId,
      }),
    );
    return { session: created, secret };
  }

  /**
   * Starts an applicant's session (state `identified`) in the caller's transaction, which is in
   * the `platform` context. Returns it with its secret, which is never stored and must reach the
   * caller once.
   */
  async createApplicant(
    tx: Transaction,
    values: NewApplicantSession,
    now: Date,
  ): Promise<{ session: ApplicantSessionRow; secret: string }> {
    const secret = newSessionSecret();
    const [session] = await tx
      .insert(onboardingSessions)
      .values({
        kind: 'applicant',
        tenant: null,
        rosterRecordId: null,
        secretHash: hashSessionSecret(secret),
        state: 'identified',
        email: values.email,
        emailSource: 'applicant',
        phone: values.phone,
        phoneSource: 'applicant',
        documentKind: values.documentKind,
        documentNumber: values.documentNumber,
        documentCountry: values.documentCountry,
        surname: values.surname,
        firstName: values.firstName,
        otherNames: values.otherNames,
        // IPRS answered before the session started; a passport is not checked.
        iprsOutcome: values.documentKind === 'national-id' ? 'match' : null,
        clientIpHash: values.clientIpHash,
        expiresAt: initialExpiry(now),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!session) throw new Error('insert returned no row');
    const created = asApplicant(session);
    await this.events.record(
      tx,
      onboardingSessionStarted(null, { sessionId: created.id, kind: 'applicant' }),
    );
    return { session: created, secret };
  }

  /**
   * Moves a live session to its next live state (409 if the state machine does not allow it),
   * with any other column changes, and records `onboarding.session.advanced.v1`. `extend` moves
   * the expiry on by a successful step's extension (capped); the first move after identify does
   * not extend.
   */
  async transition<S extends SessionRow>(
    tx: Transaction,
    session: S,
    to: Exclude<OnboardingState, TerminalState>,
    now: Date,
    { extend = true, set = {} }: { extend?: boolean; set?: SessionChanges } = {},
  ): Promise<S> {
    if (!canTransition(session.state, to, session.kind)) throw wrongStep();
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
  async end<S extends SessionRow>(
    tx: Transaction,
    session: S,
    reason: EndReason,
    now: Date,
    set: SessionChanges = {},
  ): Promise<S> {
    const state: TerminalState =
      reason === 'confirmed' || reason === 'identity-mismatch' ? reason : 'expired';
    if (!canTransition(session.state, state, session.kind)) throw wrongStep();
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
  async amend<S extends SessionRow>(tx: Transaction, session: S, set: SessionChanges): Promise<S> {
    return this.update(tx, session, { ...set, state: session.state });
  }

  /** A declarant's session as the contract shows it: masked contacts, roster details once due. */
  async view(tx: Transaction, session: DeclarantSessionRow, now: Date): Promise<OnboardingSession> {
    const commission = await commissionOfSession(tx, session);
    const [person] = session.personId
      ? await tx.select({ ofr: persons.ofr }).from(persons).where(eq(persons.id, session.personId))
      : [];

    return {
      id: session.id,
      state: session.state,
      commission,
      contacts: {
        email: declarantContactView(session, 'email'),
        phone: declarantContactView(session, 'phone'),
      },
      details: showsDetails(session.state) ? await this.details(tx, session) : null,
      otp: await this.otpView(tx, session, now),
      outcome: session.outcome,
      ofr: person?.ofr ?? null,
      setPasswordEmail: setPasswordEmailStatus(session),
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  /**
   * An applicant's session as the contract shows it (`ApplicantOnboardingSession`): the document
   * kind, masked contacts, the identity status the account gets, the code or the set-password
   * email.
   */
  async applicantView(
    tx: Transaction,
    session: ApplicantSessionRow,
    now: Date,
  ): Promise<ApplicantOnboardingSession> {
    const phone = sessionContact(session, 'phone');
    const email = sessionContact(session, 'email');
    const otp = await this.otpView(tx, session, now);
    return {
      id: session.id,
      state: session.state,
      identityDocument: { kind: session.documentKind },
      identityStatus: session.documentKind === 'national-id' ? 'verified' : 'pending-verification',
      contacts: {
        phone:
          phone.value === null
            ? null
            : { masked: maskContact('phone', phone.value), verified: phone.verifiedAt !== null },
        email: email.value === null ? null : { masked: maskContact('email', email.value) },
      },
      // An applicant's session waits for no email code (`session-state.ts`).
      otp: { ...otp, channel: otp.channel === 'phone' ? 'phone' : null },
      outcome: session.outcome === 'account-created' ? 'account-created' : null,
      setPasswordEmail: setPasswordEmailStatus(session),
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  /**
   * The code the session waits for (resend availability, resends and attempts left), or, once
   * confirmed with a new account, when the set-password email may be sent again.
   */
  private async otpView(tx: Transaction, session: SessionRow, now: Date) {
    const channel = pendingChannel(session.state);
    if (!channel) {
      return {
        channel: null,
        resendAvailableAt: passwordEmailAvailableAt(session, now),
        resendsLeft: 0,
        attemptsLeft: 0,
      };
    }
    const [otp] = await tx
      .select()
      .from(onboardingOtps)
      .where(and(eq(onboardingOtps.sessionId, session.id), eq(onboardingOtps.channel, channel)));
    return {
      channel,
      resendAvailableAt: otp
        ? new Date(
            Math.max(resendAvailableAt(otp.lastSentAt).getTime(), now.getTime()),
          ).toISOString()
        : null,
      resendsLeft: ONBOARDING_TIMING.otpResends - (otp?.resends ?? 0),
      attemptsLeft: ONBOARDING_TIMING.otpAttempts - (otp?.attempts ?? 0),
    };
  }

  private async details(tx: Transaction, session: DeclarantSessionRow) {
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

  /** Kind, tenant, record and an applicant's particulars never change, so `S` still holds. */
  private async update<S extends SessionRow>(
    tx: Transaction,
    session: S,
    changes: SessionChanges & { state: OnboardingState },
  ): Promise<S> {
    const [updated] = await tx
      .update(onboardingSessions)
      .set(changes)
      .where(eq(onboardingSessions.id, session.id))
      .returning();
    if (!updated) throw new Error(`Session ${session.id} is gone`);
    return updated as S;
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

function declarantContactView(session: DeclarantSessionRow, channel: ContactChannel) {
  const { value, source, verifiedAt } = sessionContact(session, channel);
  if (value === null || source === null || source === 'applicant') return null;
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
