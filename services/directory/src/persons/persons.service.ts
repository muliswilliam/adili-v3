import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible, PLATFORM_TENANT } from '@adili/api-kit';
import { type Database, InjectDatabase, type TenantContext, withTenant } from '@adili/data-access';
import { and, asc, eq, exists, inArray, or } from 'drizzle-orm';

import type { Transaction } from '../commissions/commissions.service.js';
import { commissions, type DirectorySchema, persons, rosterRecords } from '../db/schema.js';
import type {
  DeclarantProfile,
  PersonContacts,
  PersonNationalId,
  PersonSummary,
} from './representation.js';

/**
 * Reading persons (spec 03): a declarant's own profile, found by the subject of their token, and
 * the helpdesk's lookup by officer reference, and a person's verified contacts for notifications.
 * Persons are platform-level; their roster records are read in the platform context, since the
 * reads span Commissions. Applicants' own reads and writes are `ApplicantsService`'s.
 */
@Injectable()
export class PersonsService {
  constructor(@InjectDatabase() private readonly db: Database<DirectorySchema>) {}

  /**
   * The declarant whose Keycloak account is `subject`, with their roster records; 404 if none
   * (a law-enforcement officer's person is not a declarant).
   */
  async declarantProfile(subject: string): Promise<DeclarantProfile> {
    return withTenant(this.db, { tenant: PLATFORM_TENANT, subject }, async (tx) => {
      const [found] = await tx
        .select()
        .from(persons)
        .where(and(eq(persons.keycloakUserId, subject), eq(persons.kind, 'declarant')));
      const person = notFoundIfInvisible(found?.ofr ? { ...found, ofr: found.ofr } : undefined);
      const records = await tx
        .select({
          slug: commissions.slug,
          name: commissions.name,
          personnelFileNumber: rosterRecords.personnelFileNumber,
          rosterRecordId: rosterRecords.id,
          state: rosterRecords.state,
          onboardedAt: rosterRecords.onboardedAt,
        })
        .from(rosterRecords)
        .innerJoin(commissions, eq(commissions.slug, rosterRecords.tenant))
        .where(eq(rosterRecords.personId, person.id))
        .orderBy(asc(commissions.name), asc(rosterRecords.id));
      return {
        personId: person.id,
        ofr: person.ofr,
        fullName: person.fullName,
        contacts: { email: person.email, phone: person.phone },
        commissions: records.map((record) => ({
          ...record,
          onboardedAt: record.onboardedAt?.toISOString() ?? null,
        })),
      };
    });
  }

  /**
   * Account metadata of the person with officer reference `ofr`, for the helpdesk: who and
   * where, never the roster records' contents; 404 if none.
   */
  async findByOfr(subject: string, ofr: string): Promise<PersonSummary> {
    return withTenant(this.db, { tenant: PLATFORM_TENANT, subject }, async (tx) => {
      const [person] = await tx
        .select({
          id: persons.id,
          fullName: persons.fullName,
          createdAt: persons.createdAt,
        })
        .from(persons)
        .where(eq(persons.ofr, ofr));
      const found = notFoundIfInvisible(person);
      const records = await tx
        .selectDistinct({ tenant: rosterRecords.tenant })
        .from(rosterRecords)
        .where(eq(rosterRecords.personId, found.id))
        .orderBy(asc(rosterRecords.tenant));
      return {
        personId: found.id,
        ofr,
        fullName: found.fullName,
        commissions: records.map((record) => record.tenant),
        createdAt: found.createdAt.toISOString(),
      };
    });
  }

  /**
   * A declarant's contacts verified at their latest onboarding, null where none; a
   * law-enforcement officer's provisioned ones; an applicant's entered at applicant onboarding.
   * 404 if no such person, or a declarant not onboarded at the acting tenant. Officers and
   * applicants belong to no Commission and request from any, so any tenant's messages may reach
   * them.
   */
  async contacts(context: TenantContext, personId: string): Promise<PersonContacts> {
    const [person] = await withTenant(this.db, context, (tx) =>
      tx
        .select({ personId: persons.id, email: persons.email, phone: persons.phone })
        .from(persons)
        .where(
          and(
            eq(persons.id, personId),
            or(
              inArray(persons.kind, ['law-enforcement', 'applicant']),
              onboardedAt(tx, context.tenant),
            ),
          ),
        )
        .limit(1),
    );
    return notFoundIfInvisible(person);
  }

  /**
   * The national ID a declarant was onboarded with; 404 if no declarant onboarded at the tenant
   * has this id (law-enforcement officers and applicants are not looked up in registries).
   */
  async nationalId(context: TenantContext, personId: string): Promise<PersonNationalId> {
    const [person] = await withTenant(this.db, context, (tx) =>
      tx
        .select({ nationalId: persons.nationalId })
        .from(persons)
        .where(
          and(
            eq(persons.id, personId),
            eq(persons.kind, 'declarant'),
            onboardedAt(tx, context.tenant),
          ),
        )
        .limit(1),
    );
    // A declarant always has one; only an applicant may have a passport instead.
    return notFoundIfInvisible(person?.nationalId ? { nationalId: person.nationalId } : null);
  }
}

/** The person is onboarded at the acting tenant: its roster records are the only ones RLS shows. */
function onboardedAt(tx: Transaction, tenant: string) {
  return exists(
    tx
      .select({ id: rosterRecords.id })
      .from(rosterRecords)
      .where(and(eq(rosterRecords.personId, persons.id), eq(rosterRecords.tenant, tenant))),
  );
}
