import { Injectable } from '@nestjs/common';
import { ProblemException, PLATFORM_TENANT } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, eq, sql } from 'drizzle-orm';

import { Clock } from '../../clock.js';
import { config } from '../../config.js';
import type { DirectorySchema } from '../../db/schema.js';
import { fileNumberKey, normaliseNationalId } from '../../roster/normalise.js';
import { rosterRecords } from '../../roster/schema.js';
import { findActiveCommission } from '../commissions/onboarding-commission.js';
import { OnboardingFailures } from '../failures/onboarding-failures.js';
import { OtpIssuer } from '../otp/otp-issuer.js';
import { reject, unwrap } from '../rejection.js';
import type { IdentifyDeclarantBody, OnboardingSessionCreated } from '../representation.js';
import { keyedHash } from '../secret.js';
import { ONBOARDING_SUBJECT, OnboardingSessions } from '../sessions.repository.js';

/**
 * Identify (spec 03, step 2): matches a personnel file number and national ID against one
 * Commission's roster and starts an onboarding session for the record.
 *
 * - The Commission must be active and have imported a roster, else 409 `no-roster` (the route's
 *   rate limits refund it: the Commission list already says so). An unknown slug is the same.
 * - Match rule: the record of that Commission whose file number equals the input trimmed and
 *   case-insensitively, and whose national ID equals the input's digits.
 * - No such record, or an `exited` one: 404 `no-match`, one answer for every cause (wrong ID,
 *   wrong file number, exited, not on the roster) with the same work behind it (one lookup, one
 *   failure count), so neither the body nor the timing says which. Counted per Commission.
 * - An `onboarded` record: 409 `already-onboarded` with sign-in and recover-access links.
 * - Otherwise a session starts. With an email on the record its code is sent at once
 *   (`email-pending`, the send outside the transaction: `OtpIssuer.sending`); without one the
 *   declarant supplies it (`email-contact-required`).
 */
@Injectable()
export class IdentifyService {
  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly sessions: OnboardingSessions,
    private readonly otp: OtpIssuer,
    private readonly failures: OnboardingFailures,
    private readonly clock: Clock,
  ) {}

  async identify(
    body: IdentifyDeclarantBody,
    clientIp: string | undefined,
  ): Promise<OnboardingSessionCreated> {
    const commission = await withTenant(
      this.db,
      { tenant: PLATFORM_TENANT, subject: ONBOARDING_SUBJECT },
      (tx) => findActiveCommission(tx, body.commission),
    );
    if (!commission?.hasRoster) throw ProblemException.fromCode('no-roster');

    const fileNumber = fileNumberKey(body.personnelFileNumber);
    const nationalId = normaliseNationalId(body.nationalId);
    const clientIpHash = clientIp ? keyedHash(config.ONBOARDING_HMAC_KEY, 'ip', clientIp) : null;
    const result = await this.otp.sending((issue) =>
      withTenant(this.db, { tenant: commission.slug, subject: ONBOARDING_SUBJECT }, async (tx) => {
        const now = this.clock.now();
        const [record] = await tx
          .select({
            id: rosterRecords.id,
            state: rosterRecords.state,
            email: rosterRecords.email,
            phone: rosterRecords.phone,
          })
          .from(rosterRecords)
          .where(
            and(
              eq(rosterRecords.tenant, commission.slug),
              sql`lower(${rosterRecords.personnelFileNumber}) = ${fileNumber}`,
              eq(rosterRecords.nationalId, nationalId),
            ),
          );
        if (!record || record.state === 'exited') {
          await this.failures.record(tx, commission.slug, now);
          return reject(noMatch());
        }
        if (record.state === 'onboarded') return reject(alreadyOnboarded());

        const { session, secret } = await this.sessions.create(
          tx,
          {
            tenant: commission.slug,
            rosterRecordId: record.id,
            email: record.email,
            phone: record.phone,
            clientIpHash,
          },
          now,
        );
        let current;
        if (session.email) {
          await issue(tx, session, 'email', { commissionName: commission.name, now });
          current = await this.sessions.transition(tx, session, 'email-pending', now, {
            extend: false,
          });
        } else {
          current = await this.sessions.transition(tx, session, 'email-contact-required', now, {
            extend: false,
          });
        }
        return { ...(await this.sessions.view(tx, current, now)), secret };
      }),
    );
    return unwrap(result);
  }
}

function noMatch(): ProblemException {
  return ProblemException.fromCode('no-match');
}

/** 409 `already-onboarded`, with links to sign in and to recover access. */
export function alreadyOnboarded(): ProblemException {
  const portal = config.PORTAL_URL.replace(/\/+$/, '');
  return ProblemException.fromCode('already-onboarded', {
    extensions: {
      links: { signIn: `${portal}/auth/login`, recoverAccess: `${portal}/auth/recover` },
    },
  });
}
