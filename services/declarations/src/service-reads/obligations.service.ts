import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible } from '@adili/api-kit';
import { type Database, InjectDatabase, type TenantContext, withTenant } from '@adili/data-access';
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { DeclarationsSchema } from '../db/schema.js';
import { filingObligations, rosterSnapshots } from '../obligations/schema.js';
import type {
  InternalObligation,
  InternalObligationDetails,
  InternalPersonObligation,
} from './representation.js';

/**
 * Filing obligations as other services read them: one obligation and a person's history for the
 * review service's enforcement ladder and referral sweep (spec 08 #196), and the officers behind
 * a batch of obligations for the reporting service's Form M (spec 09 #220). Only the acting
 * Commission's obligations are seen (RLS); anything else is 404 or left out.
 */
@Injectable()
export class ServiceObligationsService {
  constructor(@InjectDatabase() private readonly db: Database<DeclarationsSchema>) {}

  /** One obligation of the Commission, with the declarant it falls on; 404 when it has none. */
  async obligation(read: TenantContext, obligationId: string): Promise<InternalObligation> {
    const [found] = await withTenant(this.db, read, (tx) =>
      tx
        .select({
          obligationId: filingObligations.id,
          rosterRecordId: filingObligations.rosterRecordId,
          personId: filingObligations.personId,
          type: filingObligations.type,
          cycleKey: filingObligations.cycleKey,
          dueDate: filingObligations.dueDate,
          status: filingObligations.status,
          declarantName: rosterSnapshots.fullName,
          personnelFileNumber: rosterSnapshots.personnelFileNumber,
        })
        .from(filingObligations)
        .innerJoin(
          rosterSnapshots,
          eq(rosterSnapshots.rosterRecordId, filingObligations.rosterRecordId),
        )
        .where(
          and(eq(filingObligations.id, obligationId), eq(filingObligations.tenant, read.tenant)),
        ),
    );
    return notFoundIfInvisible(found);
  }

  /**
   * The person's obligations at the Commission, oldest first: type, cycle, status, due date and
   * whether and when it was filed. 404 when the Commission has none for the person.
   */
  async personHistory(read: TenantContext, personId: string): Promise<InternalPersonObligation[]> {
    const rows = await withTenant(this.db, read, (tx) =>
      tx
        .select({
          obligationId: filingObligations.id,
          type: filingObligations.type,
          cycleKey: filingObligations.cycleKey,
          status: filingObligations.status,
          dueDate: filingObligations.dueDate,
          filedAt: filingObligations.filedAt,
          late: filingObligations.late,
        })
        .from(filingObligations)
        .where(
          and(eq(filingObligations.personId, personId), eq(filingObligations.tenant, read.tenant)),
        )
        .orderBy(asc(filingObligations.statementDate), asc(filingObligations.id)),
    );
    notFoundIfInvisible(rows[0]);
    return rows.map((row) => ({ ...row, filedAt: row.filedAt?.toISOString() ?? null }));
  }

  /**
   * The officer behind each of the Commission's obligations among `obligationIds`, as Form M names
   * them; an id the Commission does not hold is left out.
   */
  async details(read: TenantContext, obligationIds: string[]): Promise<InternalObligationDetails> {
    const rows = await withTenant(this.db, read, (tx) =>
      tx
        .select({
          obligationId: filingObligations.id,
          name: rosterSnapshots.fullName,
          designation: rosterSnapshots.designation,
          fileNumber: rosterSnapshots.personnelFileNumber,
          appointmentDate: rosterSnapshots.appointmentDate,
          exitDate: rosterSnapshots.exitDate,
        })
        .from(filingObligations)
        .innerJoin(
          rosterSnapshots,
          eq(rosterSnapshots.rosterRecordId, filingObligations.rosterRecordId),
        )
        .where(
          and(
            inArray(filingObligations.id, obligationIds),
            eq(filingObligations.tenant, read.tenant),
          ),
        )
        .orderBy(asc(filingObligations.id)),
    );
    return { items: rows.map((row) => ({ ...row, designation: row.designation ?? '' })) };
  }
}
