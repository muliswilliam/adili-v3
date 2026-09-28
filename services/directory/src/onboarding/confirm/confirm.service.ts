import { Injectable, Logger } from '@nestjs/common';
import { errorType, ProblemException } from '@adili/api-kit';
import { EventPublisher } from '@adili/events';
import { allocateReference, OFR } from '@adili/numbering';
import { eq, sql } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import {
  EmailTaken,
  IdentityProvisioning,
  IdentityUnavailable,
  IdentityUserNotFound,
  type Restore,
} from '../../identity/identity-provisioning.js';
import { persons } from '../../persons/schema.js';
import { recomputeRosterSummary } from '../../roster/summary.js';
import { rosterRecords } from '../../roster/schema.js';
import { declarantOnboarded, onboardingIdentityMismatch } from '../events.js';
import { IprsLookup, IprsUnavailable } from '../iprs/iprs-lookup.js';
import { namesMatch } from '../iprs/name-rule.js';
import { reject } from '../rejection.js';
import type { OnboardingConfirmResult } from '../representation.js';
import { extendedExpiry, type OnboardingOutcome } from '../session-state.js';
import {
  OnboardingSessions,
  sessionEnded,
  type SessionContext,
  type SessionRow,
  wrongStep,
} from '../sessions.repository.js';
import { setPasswordEmail } from './set-password-email.js';

type RosterRecord = Pick<
  typeof rosterRecords.$inferSelect,
  'id' | 'state' | 'fullName' | 'nationalId'
>;

/**
 * Confirm (spec 03, steps 5 and 6): the IPRS check, then the account.
 *
 * - The session must be `phone-verified` (409 otherwise). A record that exited, or onboarded
 *   through another session meanwhile, ends the session (410): starting again says why.
 * - IPRS through the integration-gateway, by the record's national ID. Unavailable: 503
 *   `iprs-unavailable`, nothing changes. No such person, or names that break the name rule
 *   (`name-rule.ts`): the record is flagged (`identityMismatchAt`), the session ends
 *   `identity-mismatch`, 200 with that outcome.
 * - Match, in one transaction with the identity provider's calls inside it: a person new to the
 *   platform gets an OFR, a person row and a declarant account with its set-password email
 *   (`account-created`); a person onboarded with another Commission gets this Commission added
 *   to their account (`linked-existing-account`). The record becomes `onboarded`, linked to the
 *   person, with the contacts the declarant supplied written back; the summary is recomputed; the
 *   session is `confirmed`; `declarant.onboarded.v1` is recorded.
 * - The identity provider failing: everything rolls back, what it had already done is undone
 *   (account deleted, tenant removed), 502 `identity-unavailable`; the declarant retries. The
 *   verified email on another account: 409 `email-in-use`, nothing changed.
 *
 * The session row stays locked while IPRS and the identity provider answer, so a double submit
 * waits and then sees `confirmed` (409) instead of creating a second account.
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

  async confirm(sessionId: string, secret: string | undefined): Promise<OnboardingConfirmResult> {
    // What the identity provider did, to undo if the transaction does not commit.
    const undo: Restore[] = [];
    try {
      return await this.sessions.withLiveSession(sessionId, secret, async (context) => {
        const { tx, session, now } = context;
        if (session.state !== 'phone-verified') throw wrongStep();
        const record = await lockRecord(tx, session.rosterRecordId);
        if (record.state !== 'not_onboarded') {
          await this.sessions.end(tx, session, 'expired', now);
          return reject(sessionEnded());
        }
        const person = await this.lookUp(session, record);
        if (person === 'not-found' || person === 'mismatch') {
          return this.mismatch(context, record, person);
        }
        return this.onboard(context, record, undo);
      });
    } catch (error) {
      await this.undo(undo, sessionId);
      if (error instanceof EmailTaken) throw ProblemException.fromCode('email-in-use');
      if (error instanceof IdentityUnavailable || error instanceof IdentityUserNotFound) {
        this.logger.warn(
          { sessionId, err: errorType(error) },
          'Declarant account not created or linked',
        );
        throw ProblemException.fromCode('identity-unavailable');
      }
      throw error;
    }
  }

  /** Whether IPRS knows the record's national ID under the record's names. */
  private async lookUp(
    session: SessionRow,
    record: RosterRecord,
  ): Promise<'match' | 'mismatch' | 'not-found'> {
    try {
      const person = await this.iprs.find(record.nationalId);
      if (!person) return 'not-found';
      return namesMatch(person, record.fullName) ? 'match' : 'mismatch';
    } catch (error) {
      if (!(error instanceof IprsUnavailable)) throw error;
      this.logger.warn({ sessionId: session.id, err: errorType(error) }, 'IPRS check not run');
      throw ProblemException.fromCode('iprs-unavailable');
    }
  }

  /** Flags the record for its reporting officer and ends the session `identity-mismatch`. */
  private async mismatch(
    { tx, session, now }: SessionContext,
    record: RosterRecord,
    iprsOutcome: 'mismatch' | 'not-found',
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
  ): Promise<OnboardingConfirmResult> {
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
      const restore = await this.identity.addTenantToUser(existing.keycloakUserId, session.tenant);
      if (restore) undo.push(restore);
      await tx
        .update(persons)
        .set({ email, phone, updatedAt: now })
        .where(eq(persons.id, existing.id));
      person = existing;
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
        // Contacts the declarant supplied (the record had none) become the record's.
        ...(session.emailSource === 'declarant' ? { email, emailSource: 'declarant' } : {}),
        ...(session.phoneSource === 'declarant' ? { phone, phoneSource: 'declarant' } : {}),
        updatedAt: now,
      })
      .where(eq(rosterRecords.id, record.id));
    await recomputeRosterSummary(tx, session.tenant);
    const ended = await this.sessions.end(tx, session, 'confirmed', now, {
      outcome,
      iprsOutcome: 'match',
      personId: person.id,
      // The check-email step and its resends run on this session: give it a step's time.
      expiresAt: extendedExpiry(session),
      ...(outcome === 'account-created' ? { passwordEmailSentAt: now } : {}),
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
    // Last, so nothing after it can fail and leave an email pointing at an undone account.
    if (outcome === 'account-created') {
      await this.identity.sendExecuteActionsEmail(person.keycloakUserId, setPasswordEmail());
    }
    return { outcome, session: await this.sessions.view(tx, ended, now) };
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

/** The session's record, locked (records before the summary, as every roster change). */
async function lockRecord(tx: Transaction, recordId: string): Promise<RosterRecord> {
  const [record] = await tx
    .select({
      id: rosterRecords.id,
      state: rosterRecords.state,
      fullName: rosterRecords.fullName,
      nationalId: rosterRecords.nationalId,
    })
    .from(rosterRecords)
    .where(eq(rosterRecords.id, recordId))
    .for('update');
  if (!record) throw new Error(`Roster record ${recordId} is gone`);
  return record;
}

/** A person id before the row exists: the account carries it as `person_id`. */
async function newPersonId(tx: Transaction): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`select uuidv7() as id`);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('uuidv7() returned no id');
  return id;
}
