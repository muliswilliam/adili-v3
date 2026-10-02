import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { errorType, PLATFORM_TENANT, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';

import { Clock } from '../../clock.js';
import { config } from '../../config.js';
import type { DirectorySchema } from '../../db/schema.js';
import { applicantIdentityMismatch } from '../events.js';
import { alreadyOnboarded } from '../identify/identify.service.js';
import { IprsLookup, IprsUnavailable } from '../iprs/iprs-lookup.js';
import { namesMatch } from '../iprs/name-rule.js';
import { OtpIssuer } from '../otp/otp-issuer.js';
import { keyedHash } from '../secret.js';
import { ONBOARDING_SUBJECT, OnboardingSessions } from '../sessions.repository.js';
import { applicantExists } from './identity-document.js';
import type {
  ApplicantOnboardingSessionCreated,
  StartApplicantOnboardingBody,
} from './representation.js';

/**
 * Starting applicant onboarding (spec 10): a member of the public gives an identity document,
 * names, phone and email, and a session starts with the phone's code sent at once.
 *
 * - National ID: IPRS is asked first, outside any transaction, through the integration-gateway.
 *   No such person, or names that break the name rule (`name-rule.ts`, the names entered in place
 *   of a roster name): 409 `identity-mismatch`, nothing stored but
 *   `applicant.identity-mismatch.v1` (ids and the hashed client IP). IPRS unavailable: 503
 *   `iprs-unavailable`.
 * - Passport: not checked; the account will be `pending-verification` until an access officer
 *   verifies the particulars entered.
 * - An applicant with that document already: 409 `already-onboarded` (with sign-in and
 *   recover-access links). For a national ID this is only said once IPRS matched the names.
 * - Otherwise the session starts (`phone-pending`), its code sent before the transaction
 *   commits (`OtpIssuer.sending`; 502 `otp-send-failed` stores nothing).
 *
 * Applicant sessions have no Commission: they live in the `platform` context, and their failed
 * attempts count against no Commission. The route shares identify's per client IP budget.
 */
@Injectable()
export class ApplicantStartService {
  private readonly logger = new Logger(ApplicantStartService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly sessions: OnboardingSessions,
    private readonly otp: OtpIssuer,
    private readonly iprs: IprsLookup,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
  ) {}

  async start(
    body: StartApplicantOnboardingBody,
    clientIp: string | undefined,
  ): Promise<ApplicantOnboardingSessionCreated> {
    const { identityDocument: document, names } = body;
    const clientIpHash = clientIp ? keyedHash(config.ONBOARDING_HMAC_KEY, 'ip', clientIp) : null;
    if (document.kind === 'national-id') {
      const fullName = [names.firstName, names.otherNames, names.surname].filter(Boolean).join(' ');
      if (!(await this.iprsMatches(document.number, fullName))) {
        await this.recordMismatch(clientIpHash);
        throw ProblemException.fromCode('identity-mismatch');
      }
    }

    return this.otp.sending((issue) =>
      withTenant(this.db, { tenant: PLATFORM_TENANT, subject: ONBOARDING_SUBJECT }, async (tx) => {
        const now = this.clock.now();
        if (await applicantExists(tx, document)) throw alreadyOnboarded();
        const { session, secret } = await this.sessions.createApplicant(
          tx,
          {
            documentKind: document.kind,
            documentNumber: document.number,
            documentCountry: document.country,
            surname: names.surname,
            firstName: names.firstName,
            otherNames: names.otherNames,
            email: body.email,
            phone: body.phone,
            clientIpHash,
          },
          now,
        );
        await issue(tx, session, 'phone', { now });
        const pending = await this.sessions.transition(tx, session, 'phone-pending', now, {
          extend: false,
        });
        return { ...(await this.sessions.applicantView(tx, pending, now)), secret };
      }),
    );
  }

  /** Whether IPRS knows `nationalId` under these names (503 `iprs-unavailable` if it cannot say). */
  private async iprsMatches(nationalId: string, fullName: string): Promise<boolean> {
    let person;
    try {
      person = await this.iprs.find(nationalId);
    } catch (error) {
      if (!(error instanceof IprsUnavailable)) throw error;
      this.logger.warn({ err: errorType(error) }, 'IPRS check of an applicant not run');
      throw ProblemException.fromCode('iprs-unavailable');
    }
    return person !== null && namesMatch(person, fullName);
  }

  /** Records a start IPRS refused, with no session and nothing of the person (ADR-008). */
  private async recordMismatch(clientIpHash: string | null): Promise<void> {
    await withTenant(this.db, { tenant: PLATFORM_TENANT, subject: ONBOARDING_SUBJECT }, (tx) =>
      this.events.record(tx, applicantIdentityMismatch({ attemptId: randomUUID(), clientIpHash })),
    );
  }
}
