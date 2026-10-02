import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible, PLATFORM_TENANT } from '@adili/api-kit';
import { type Database, InjectDatabase, type TenantContext, withTenant } from '@adili/data-access';
import { and, asc, eq, exists } from 'drizzle-orm';

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
 * reads span Commissions.
 */
@Injectable()
export class PersonsService {
  constructor(@InjectDatabase() private readonly db: Database<DirectorySchema>) {}

  /** The person whose Keycloak account is `subject`, with their roster records; 404 if none. */
  async declarantProfile(subject: string): Promise<DeclarantProfile> {
    return withTenant(this.db, { tenant: PLATFORM_TENANT, subject }, async (tx) => {
      const [found] = await tx.select().from(persons).where(eq(persons.keycloakUserId, subject));
      const person = notFoundIfInvisible(found);
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
          ofr: persons.ofr,
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
        ofr: found.ofr,
        fullName: found.fullName,
        commissions: records.map((record) => record.tenant),
        createdAt: found.createdAt.toISOString(),
      };
    });
  }

  /** The contacts verified at the person's latest onboarding, null where none; 404 if no person. */
  async contacts(context: TenantContext, personId: string): Promise<PersonContacts> {
    const [person] = await withTenant(this.db, context, (tx) =>
      tx
        .select({ personId: persons.id, email: persons.email, phone: persons.phone })
        .from(persons)
        .where(onboardedAt(tx, context.tenant, personId))
        .limit(1),
    );
    return notFoundIfInvisible(person);
  }

  /** The national ID the person was onboarded with; 404 if no person onboarded at the tenant. */
  async nationalId(context: TenantContext, personId: string): Promise<PersonNationalId> {
    const [person] = await withTenant(this.db, context, (tx) =>
      tx
        .select({ nationalId: persons.nationalId })
        .from(persons)
        .where(onboardedAt(tx, context.tenant, personId))
        .limit(1),
    );
    return notFoundIfInvisible(person);
  }
}

/**
 * The person `personId`, if onboarded at the acting tenant: its roster records are the only ones
 * RLS shows.
 */
function onboardedAt(tx: Transaction, tenant: string, personId: string) {
  return and(
    eq(persons.id, personId),
    exists(
      tx
        .select({ id: rosterRecords.id })
        .from(rosterRecords)
        .where(and(eq(rosterRecords.personId, persons.id), eq(rosterRecords.tenant, tenant))),
    ),
  );
}
