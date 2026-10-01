import { Injectable, Logger } from '@nestjs/common';
import { errorType, ProblemException } from '@adili/api-kit';
import { EventPublisher } from '@adili/events';

import {
  EmailTaken,
  IdentityProvisioning,
  IdentityUnavailable,
  IdentityUserNotFound,
  type Restore,
  UsernameTaken,
} from '../../identity/identity-provisioning.js';
import { newPersonId } from '../../persons/person-id.js';
import { type IdentityStatus, persons } from '../../persons/schema.js';
import { sendSetPasswordEmail, undoIdentityChanges } from '../confirm/account.js';
import { applicantOnboarded } from '../events.js';
import { alreadyOnboarded } from '../identify/identify.service.js';
import type { SessionCredentials } from '../public-route.js';
import { confirmedExpiry } from '../session-state.js';
import {
  type ApplicantSessionRow,
  OnboardingSessions,
  type SessionContext,
  wrongStep,
} from '../sessions.repository.js';
import {
  applicantExists,
  documentColumns,
  type IdentityDocument,
  lockDocument,
} from './identity-document.js';
import type { ApplicantOnboardingSession } from './representation.js';

/** What complete committed, and the account whose set-password email is still to send. */
interface Completed {
  session: ApplicantOnboardingSession;
  keycloakUserId: string;
}

/**
 * Completing applicant onboarding (spec 10): the person and the account.
 *
 * - The session must be `phone-verified` (409 `wrong-step` otherwise).
 * - In one transaction, with the identity provider's call inside it: a person of kind
 *   `applicant` with the document, names and contacts entered, and an account with role
 *   `applicant`, no tenant, and `identityStatus` `verified` (a national ID IPRS matched at start)
 *   or `pending-verification` (a passport); the session is `confirmed` for the 24 hours of the
 *   set-password link; `applicant.onboarded.v1` is recorded.
 * - An applicant with the document already (another session completed first): 409
 *   `already-onboarded`, nothing changed. The email on another account: 409 `email-in-use`. The
 *   identity provider failing: everything rolls back, the account is deleted again, 502
 *   `identity-unavailable`.
 * - After the commit the set-password email is sent; should that fail, the account stands and
 *   the session says `setPasswordEmail: failed`, so the portal offers to send it again.
 */
@Injectable()
export class ApplicantCompleteService {
  private readonly logger = new Logger(ApplicantCompleteService.name);

  constructor(
    private readonly sessions: OnboardingSessions,
    private readonly events: EventPublisher,
    private readonly identity: IdentityProvisioning,
  ) {}

  async complete(credentials: SessionCredentials): Promise<ApplicantOnboardingSession> {
    const { sessionId } = credentials;
    const undo: Restore[] = [];
    let completed: Completed;
    try {
      completed = await this.sessions.withLiveApplicantSession(credentials, (context) =>
        this.createAccount(context, undo),
      );
    } catch (error) {
      await undoIdentityChanges(undo, this.logger, sessionId);
      if (error instanceof EmailTaken) throw ProblemException.fromCode('email-in-use');
      if (
        error instanceof IdentityUnavailable ||
        error instanceof IdentityUserNotFound ||
        error instanceof UsernameTaken
      ) {
        this.logger.warn({ sessionId, err: errorType(error) }, 'Applicant account not created');
        throw ProblemException.fromCode('identity-unavailable');
      }
      throw error;
    }

    if (
      await sendSetPasswordEmail(this.identity, this.logger, sessionId, completed.keycloakUserId)
    ) {
      return completed.session;
    }
    // The session forgets when the email went, so it says `failed` and resend is open at once.
    return this.sessions.withLiveApplicantSession(credentials, async ({ tx, session, now }) => {
      const amended = await this.sessions.amend(tx, session, {
        passwordEmailSentAt: null,
        updatedAt: now,
      });
      return this.sessions.applicantView(tx, amended, now);
    });
  }

  private async createAccount(
    { tx, session, now }: SessionContext<ApplicantSessionRow>,
    undo: Restore[],
  ): Promise<Completed> {
    if (session.state !== 'phone-verified') throw wrongStep();
    const { email, phone } = session;
    if (email === null || phone === null) {
      throw new Error(`Applicant session ${session.id} is phone-verified without its contacts`);
    }
    const document: IdentityDocument = {
      kind: session.documentKind,
      number: session.documentNumber,
      country: session.documentCountry,
    };
    await lockDocument(tx, document);
    if (await applicantExists(tx, document)) throw alreadyOnboarded();

    const identityStatus: IdentityStatus =
      document.kind === 'national-id' ? 'verified' : 'pending-verification';
    const firstName = [session.firstName, session.otherNames].filter(Boolean).join(' ');
    const id = await newPersonId(tx);
    const keycloakUserId = await this.identity.createApplicantUser({
      email,
      firstName,
      lastName: session.surname,
      phone,
      personId: id,
      identityStatus,
    });
    undo.push(() => this.identity.deleteUser(keycloakUserId));
    await tx.insert(persons).values({
      id,
      kind: 'applicant',
      ...documentColumns(document),
      fullName: `${firstName} ${session.surname}`,
      identityStatus,
      // IPRS matched the national ID at start; a passport waits for an access officer.
      identityVerifiedAt: identityStatus === 'verified' ? now : null,
      keycloakUserId,
      email,
      phone,
      createdAt: now,
      updatedAt: now,
    });
    const ended = await this.sessions.end(tx, session, 'confirmed', now, {
      outcome: 'account-created',
      personId: id,
      expiresAt: confirmedExpiry(now),
      passwordEmailSentAt: now,
    });
    await this.events.record(
      tx,
      applicantOnboarded({
        personId: id,
        keycloakUserId,
        sessionId: session.id,
        documentKind: document.kind,
        identityStatus,
      }),
    );
    return { session: await this.sessions.applicantView(tx, ended, now), keycloakUserId };
  }
}
