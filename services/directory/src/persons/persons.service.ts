import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { asc, eq } from 'drizzle-orm';

import { PLATFORM_TENANT } from '../commissions/access.js';
import { commissions, type DirectorySchema, persons, rosterRecords } from '../db/schema.js';
import type { DeclarantProfile, PersonSummary } from './representation.js';

/**
 * Reading persons (spec 03): a declarant's own profile, found by the subject of their token, and
 * the helpdesk's lookup by officer reference. Persons are platform-level; their roster records
 * are read in the platform context, since both reads span Commissions.
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
}
