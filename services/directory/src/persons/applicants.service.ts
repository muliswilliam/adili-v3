import { Injectable, Logger } from '@nestjs/common';
import { errorType, notFoundIfInvisible, PLATFORM_TENANT, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, type SQL } from 'drizzle-orm';

import { Clock } from '../clock.js';
import type { Transaction } from '../commissions/commissions.service.js';
import type { DirectorySchema } from '../db/schema.js';
import {
  IdentityProvisioning,
  IdentityUnavailable,
  IdentityUserNotFound,
  type Restore,
} from '../identity/identity-provisioning.js';
import { applicantIdentityVerified } from './events.js';
import type { ApplicantProfile, InternalApplicant } from './representation.js';
import { persons } from './schema.js';

type PersonRow = typeof persons.$inferSelect;

/**
 * Applicants (spec 10): persons of kind `applicant`, created by applicant onboarding. Their own
 * profile, what the access service reads of them, and an access officer's manual verification of
 * a passport applicant, which the access service records here. Applicants belong to no tenant;
 * persons are platform-level, so every read runs in the platform context.
 */
@Injectable()
export class ApplicantsService {
  private readonly logger = new Logger(ApplicantsService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly identity: IdentityProvisioning,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /** The applicant whose account is `subject`; 404 if none. */
  async profile(subject: string): Promise<ApplicantProfile> {
    const person = await withTenant(this.db, { tenant: PLATFORM_TENANT, subject }, (tx) =>
      findApplicant(tx, eq(persons.keycloakUserId, subject)),
    );
    return toProfile(notFoundIfInvisible(person));
  }

  /** The applicant `personId`; 404 if no applicant has it. */
  async find(subject: string, personId: string): Promise<InternalApplicant> {
    const person = await withTenant(this.db, { tenant: PLATFORM_TENANT, subject }, (tx) =>
      findApplicant(tx, eq(persons.id, personId)),
    );
    return toInternal(notFoundIfInvisible(person));
  }

  /**
   * Records that an access officer of `tenant` (`verifiedBy`) checked the particulars applicant
   * `personId` entered: identity status `verified` on the person and on the account (the
   * `identityStatus` attribute), in one transaction with the account's change undone should it
   * not commit, and `applicant.identity-verified.v1`. Idempotent: an applicant already verified
   * (by IPRS or an earlier verification) is returned as is. 404 if no applicant has the id; 502
   * `identity-unavailable` if the account could not be changed (nothing changed).
   */
  async verifyIdentity(
    { tenant, subject }: { tenant: string; subject: string },
    personId: string,
    verifiedBy: string,
  ): Promise<InternalApplicant> {
    const undo: Restore[] = [];
    try {
      return await withTenant(this.db, { tenant: PLATFORM_TENANT, subject }, async (tx) => {
        const person = notFoundIfInvisible(
          await findApplicant(tx, eq(persons.id, personId), { lock: true }),
        );
        if (person.identityStatus === 'verified') return toInternal(person);
        const now = this.clock.now();
        const restore = await this.identity.setIdentityStatus(person.keycloakUserId, 'verified');
        if (restore) undo.push(restore);
        const [updated] = await tx
          .update(persons)
          .set({
            identityStatus: 'verified',
            identityVerifiedAt: now,
            identityVerifiedBy: verifiedBy,
            updatedAt: now,
          })
          .where(eq(persons.id, person.id))
          .returning();
        if (!updated) throw new Error(`Person ${person.id} is gone`);
        await this.events.record(
          tx,
          applicantIdentityVerified(tenant, { personId: person.id, verifiedBy }),
        );
        return toInternal(updated);
      });
    } catch (error) {
      for (const restore of undo.reverse()) {
        await restore().catch((undoError: unknown) => {
          this.logger.error(
            { personId, err: errorType(undoError) },
            'Could not undo the identity status of a failed verification',
          );
        });
      }
      if (error instanceof IdentityUnavailable || error instanceof IdentityUserNotFound) {
        this.logger.warn({ personId, err: errorType(error) }, 'Applicant identity not verified');
        throw ProblemException.fromCode('identity-unavailable');
      }
      throw error;
    }
  }
}

async function findApplicant(
  tx: Transaction,
  where: SQL,
  { lock = false }: { lock?: boolean } = {},
): Promise<PersonRow | undefined> {
  const query = tx
    .select()
    .from(persons)
    .where(and(eq(persons.kind, 'applicant'), where));
  const [person] = lock ? await query.for('update') : await query;
  return person;
}

function toProfile(person: PersonRow): ApplicantProfile {
  if (person.identityStatus === null) throw new Error(`Applicant ${person.id} has no status`);
  return {
    personId: person.id,
    fullName: person.fullName,
    identityDocument:
      person.nationalId !== null
        ? { kind: 'national-id', number: person.nationalId, country: null }
        : {
            kind: 'passport',
            number: person.passportNumber ?? '',
            country: person.passportCountry,
          },
    identityStatus: person.identityStatus,
    contacts: { email: person.email, phone: person.phone },
  };
}

function toInternal(person: PersonRow): InternalApplicant {
  return {
    ...toProfile(person),
    identityVerifiedAt: person.identityVerifiedAt?.toISOString() ?? null,
    identityVerifiedBy: person.identityVerifiedBy,
  };
}
