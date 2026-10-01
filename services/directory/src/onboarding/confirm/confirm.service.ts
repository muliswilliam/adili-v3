import { Injectable, Logger } from '@nestjs/common';
import { errorType, ProblemException } from '@adili/api-kit';
import { EventPublisher } from '@adili/events';
import { allocateReference, OFR } from '@adili/numbering';
import { CONTACT_CHANNELS } from '@adili/contacts';
import { eq, sql } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import {
  EmailTaken,
  IdentityProvisioning,
  IdentityUnavailable,
  IdentityUserNotFound,
  type Restore,
  UsernameTaken,
} from '../../identity/identity-provisioning.js';
import { newPersonId } from '../../persons/person-id.js';
import { persons } from '../../persons/schema.js';
import { recomputeRosterSummary } from '../../roster/summary.js';
import { rosterRecords } from '../../roster/schema.js';
import { writeBackDeclarantContact } from '../contacts.js';
import { declarantOnboarded, onboardingIdentityMismatch } from '../events.js';
import { IprsLookup, IprsUnavailable } from '../iprs/iprs-lookup.js';
import { namesMatch } from '../iprs/name-rule.js';
import type { SessionCredentials } from '../public-route.js';
import { reject, Rejection } from '../rejection.js';
import type { OnboardingConfirmResult } from '../representation.js';
import {
  confirmedExpiry,
  extendedExpiry,
  type IprsOutcome,
  type OnboardingOutcome,
} from '../session-state.js';
import {
  OnboardingSessions,
  sessionEnded,
  type SessionContext,
  wrongStep,
} from '../sessions.repository.js';
import { setPasswordEmail } from './set-password-email.js';

type RosterRecord = Pick<
  typeof rosterRecords.$inferSelect,
  'id' | 'state' | 'fullName' | 'nationalId'
>;

/** What a confirm committed, and the set-password email it still has to send. */
interface Confirmed {
  result: OnboardingConfirmResult;
  /** The Keycloak user id of the new account whose set-password email is still to send. */
  setPasswordEmailFor?: string;
}

/** The record changed between the IPRS check and the lock: check it again. */
const RECHECK = Symbol('recheck');
/** Rounds of IPRS check and lock before giving up on a record that keeps changing. */
const MAX_ROUNDS = 3;

/**
 * Confirm (spec 03, steps 5 and 6): the IPRS check, then the account.
 *
 * - The session must be `phone-verified` (409 otherwise). A record that exited, or onboarded
 *   through another session meanwhile, ends the session (410): starting again says why.
 * - IPRS through the integration-gateway, by the record's national ID, before any lock is taken:
 *   a slow IPRS holds no row and no transaction. Unavailable: 503 `iprs-unavailable`, nothing
 *   changes. The record is then locked and checked again; should its national ID or name have
 *   changed meanwhile (an import), IPRS is asked again.
 * - No such person, or names that break the name rule (`name-rule.ts`): the record is flagged
 *   (`identityMismatchAt`), the session ends `identity-mismatch`, 200 with that outcome.
 * - Match, in one transaction with the identity provider's calls inside it (spec 03): a person
 *   new to the platform gets an OFR, a person row and a declarant account (`account-created`);
 *   a person onboarded with another Commission gets this Commission added to their account
 *   (`linked-existing-account`), their person's contacts left as they are. The record becomes
 *   `onboarded`, linked to the person, with the contacts the declarant supplied written back
 *   where the record still has none; the summary is recomputed; the session is `confirmed`
 *   (with a new account, for the 24 hours of the set-password link: `confirmedExpiry`);
 *   `declarant.onboarded.v1` is recorded.
 * - After the commit, a new account's set-password email is sent. Should that fail, the account
 *   stands, and the session says `setPasswordEmail: failed` with resend open at once, so the
 *   check-email step asks the declarant to send it (ADR-014).
 * - The identity provider failing: everything rolls back, what it had already done is undone
 *   (account deleted, the added tenant removed), 502 `identity-unavailable`; the declarant
 *   retries. The verified email on another account: 409 `email-in-use`, nothing changed.
 *
 * The session row stays locked while the identity provider answers, so a double submit waits and
 * then sees `confirmed` (409) instead of creating a second account.
 */
@Injectable()
export class ConfirmService {
  private readonly logger = new Logger(ConfirmService.name);

  constructor(
    private readonly sessions: OnboardingSessions,
    private readonly events: EventPublisher,
    private readonly iprs: IprsLookup,
    private readonly identity: IdentityProvisioning,
  ) {}

  async confirm(credentials: SessionCredentials): Promise<OnboardingConfirmResult> {
    const { sessionId } = credentials;
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const record = await this.sessions.withLiveSession(credentials, (context) =>
        this.confirmable(context, { lock: false }),
      );
      const verdict = await this.lookUp(sessionId, record);
      const confirmed = await this.decide(credentials, record, verdict);
      if (confirmed === RECHECK) continue;
      if (
        confirmed.setPasswordEmailFor &&
        !(await this.sendSetPasswordEmail(sessionId, confirmed.setPasswordEmailFor))
      ) {
        return this.setPasswordEmailFailed(credentials, confirmed.result);
      }
      return confirmed.result;
    }
    this.logger.warn({ sessionId }, 'Roster record kept changing during confirm');
    throw wrongStep();
  }

  /**
   * The session's record (locked if `lock`), if the session is at the confirm step and the
   * record can still onboard; a record that exited or onboarded otherwise ends the session.
   */
  private async confirmable(
    { tx, session, now }: SessionContext,
    { lock }: { lock: boolean },
  ): Promise<RosterRecord | Rejection> {
    if (session.state !== 'phone-verified') throw wrongStep();
    const record = await readRecord(tx, session.rosterRecordId, { lock });
    if (record.state !== 'not_onboarded') {
      await this.sessions.end(tx, session, 'expired', now);
      return reject(sessionEnded());
    }
    return record;
  }

  /** Whether IPRS knows the record's national ID under the record's names. */
  private async lookUp(sessionId: string, record: RosterRecord): Promise<IprsOutcome> {
    try {
      const person = await this.iprs.find(record.nationalId);
      if (!person) return 'not-found';
      return namesMatch(person, record.fullName) ? 'match' : 'mismatch';
    } catch (error) {
      if (!(error instanceof IprsUnavailable)) throw error;
      this.logger.warn({ sessionId, err: errorType(error) }, 'IPRS check not run');
      throw ProblemException.fromCode('iprs-unavailable');
    }
  }

  /** Under the locks: the mismatch, or the account, for the record IPRS was asked about. */
  private async decide(
    credentials: SessionCredentials,
    checked: RosterRecord,
    verdict: IprsOutcome,
  ): Promise<Confirmed | typeof RECHECK> {
    // What the identity provider did, to undo if the transaction does not commit.
    const undo: Restore[] = [];
    try {
      return await this.sessions.withLiveSession(credentials, async (context) => {
        // Records before the summary, as every roster change locks them.
        const record = await this.confirmable(context, { lock: true });
        if (record instanceof Rejection) return record;
        if (record.nationalId !== checked.nationalId || record.fullName !== checked.fullName) {
          return RECHECK;
        }
        if (verdict !== 'match') {
          return { result: await this.mismatch(context, record, verdict) };
        }
        return this.onboard(context, record, undo);
      });
    } catch (error) {
      await this.undo(undo, credentials.sessionId);
      if (error instanceof EmailTaken) throw ProblemException.fromCode('email-in-use');
      if (
        error instanceof IdentityUnavailable ||
        error instanceof IdentityUserNotFound ||
        error instanceof UsernameTaken
      ) {
        this.logger.warn(
          { sessionId: credentials.sessionId, err: errorType(error) },
          'Declarant account not created or linked',
        );
        throw ProblemException.fromCode('identity-unavailable');
      }
      throw error;
    }
  }

  /** Flags the record for its reporting officer and ends the session `identity-mismatch`. */
  private async mismatch(
    { tx, session, now }: SessionContext,
    record: RosterRecord,
    iprsOutcome: Exclude<IprsOutcome, 'match'>,
  ): Promise<OnboardingConfirmResult> {
    await tx
      .update(rosterRecords)
      .set({ identityMismatchAt: now, updatedAt: now })
      .where(eq(rosterRecords.id, record.id));
    await this.events.record(
      tx,
      onboardingIdentityMismatch(session.tenant, {
        rosterRecordId: record.id,
        sessionId: session.id,
      }),
    );
    const ended = await this.sessions.end(tx, session, 'identity-mismatch', now, {
      outcome: 'identity-mismatch',
      iprsOutcome,
    });
    return { outcome: 'identity-mismatch', session: await this.sessions.view(tx, ended, now) };
  }

  private async onboard(
    { tx, session, now }: SessionContext,
    record: RosterRecord,
    undo: Restore[],
  ): Promise<Confirmed> {
    const { email, phone } = session;
    if (email === null || phone === null) {
      throw new Error(`Session ${session.id} is phone-verified without both contacts`);
    }
    // One person per national ID: confirms for the same person at two Commissions take turns.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`person:${record.nationalId}`}, 0))`,
    );
    const [existing] = await tx
      .select({ id: persons.id, ofr: persons.ofr, keycloakUserId: persons.keycloakUserId })
      .from(persons)
      .where(eq(persons.nationalId, record.nationalId));

    let person: { id: string; ofr: string; keycloakUserId: string };
    let outcome: OnboardingOutcome;
    if (existing) {
      // Only declarants have a national ID, and every declarant has an OFR (by constraint).
      if (existing.ofr === null) throw new Error(`Person ${existing.id} has no OFR`);
      // Linking adds the Commission and nothing else: the person's contacts (and the account's)
      // stay as their first onboarding verified them.
      const restore = await this.identity.addTenantToUser(existing.keycloakUserId, session.tenant);
      if (restore) undo.push(restore);
      person = { ...existing, ofr: existing.ofr };
      outcome = 'linked-existing-account';
    } else {
      const ofr = await allocateReference(tx, OFR);
      const id = await newPersonId(tx);
      const keycloakUserId = await this.identity.createDeclarantUser({
        ofr,
        email,
        name: record.fullName,
        phone,
        tenant: session.tenant,
        personId: id,
      });
      undo.push(() => this.identity.deleteUser(keycloakUserId));
      await tx.insert(persons).values({
        id,
        nationalId: record.nationalId,
        fullName: record.fullName,
        ofr,
        keycloakUserId,
        email,
        phone,
        createdAt: now,
        updatedAt: now,
      });
      person = { id, ofr, keycloakUserId };
      outcome = 'account-created';
    }

    await tx
      .update(rosterRecords)
      .set({
        state: 'onboarded',
        personId: person.id,
        onboardedAt: now,
        identityMismatchAt: null,
        updatedAt: now,
      })
      .where(eq(rosterRecords.id, record.id));
    for (const channel of CONTACT_CHANNELS) {
      await writeBackDeclarantContact(tx, session, channel, now);
    }
    await recomputeRosterSummary(tx, session.tenant);
    const ended = await this.sessions.end(tx, session, 'confirmed', now, {
      outcome,
      iprsOutcome: 'match',
      personId: person.id,
      // A new account's check-email step resends the set-password link on this session, so it
      // lives as long as the link does; a linked account's session only has its outcome to show.
      ...(outcome === 'account-created'
        ? { expiresAt: confirmedExpiry(now), passwordEmailSentAt: now }
        : { expiresAt: extendedExpiry(session) }),
    });
    await this.events.record(
      tx,
      declarantOnboarded(session.tenant, {
        personId: person.id,
        ofr: person.ofr,
        rosterRecordId: record.id,
        keycloakUserId: person.keycloakUserId,
        linked: outcome === 'linked-existing-account',
      }),
    );
    return {
      result: { outcome, session: await this.sessions.view(tx, ended, now) },
      ...(outcome === 'account-created' ? { setPasswordEmailFor: person.keycloakUserId } : {}),
    };
  }

  /**
   * The set-password email of a committed new account; whether it went. Not sent, the account
   * stands (an email cannot be taken back, so it is not part of the transaction, ADR-014).
   */
  private async sendSetPasswordEmail(sessionId: string, keycloakUserId: string): Promise<boolean> {
    try {
      await this.identity.sendExecuteActionsEmail(keycloakUserId, setPasswordEmail());
      return true;
    } catch (error) {
      if (!(error instanceof IdentityUnavailable || error instanceof IdentityUserNotFound)) {
        throw error;
      }
      this.logger.warn(
        { sessionId, err: errorType(error) },
        'Set-password email of a new declarant account not sent; the declarant can resend it',
      );
      return false;
    }
  }

  /**
   * Records that the set-password email did not go: the session forgets when it was sent, so it
   * says `setPasswordEmail: failed` and resend is open at once, and the answer says so too.
   * A replay of this confirm (same Idempotency-Key) returns that stored `failed` answer even after
   * a later resend succeeded; the portal re-reads the session, which has the current state.
   */
  private async setPasswordEmailFailed(
    credentials: SessionCredentials,
    confirmed: OnboardingConfirmResult,
  ): Promise<OnboardingConfirmResult> {
    return this.sessions.withLiveSession(credentials, async ({ tx, session, now }) => {
      const amended = await this.sessions.amend(tx, session, {
        passwordEmailSentAt: null,
        updatedAt: now,
      });
      return { ...confirmed, session: await this.sessions.view(tx, amended, now) };
    });
  }

  /** Undoes what the identity provider did for a confirm that did not commit, latest first. */
  private async undo(undo: Restore[], sessionId: string): Promise<void> {
    for (const restore of undo.reverse()) {
      try {
        await restore();
      } catch (error) {
        this.logger.error(
          { sessionId, err: errorType(error) },
          'Could not undo an identity change of a failed confirm',
        );
      }
    }
  }
}

/** The session's record, locked for the rest of the transaction if `lock`. */
async function readRecord(
  tx: Transaction,
  recordId: string,
  { lock }: { lock: boolean },
): Promise<RosterRecord> {
  const query = tx.select(RECORD_COLUMNS).from(rosterRecords).where(eq(rosterRecords.id, recordId));
  const [record] = lock ? await query.for('update') : await query;
  if (!record) throw new Error(`Roster record ${recordId} is gone`);
  return record;
}

const RECORD_COLUMNS = {
  id: rosterRecords.id,
  state: rosterRecords.state,
  fullName: rosterRecords.fullName,
  nationalId: rosterRecords.nationalId,
};
