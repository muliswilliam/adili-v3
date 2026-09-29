import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase, withPerson, withTenant } from '@adili/data-access';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';

import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import { UUID } from '../guards.js';
import type {
  MyObligations,
  Obligation,
  ObligationDetail,
  DeclarantRef,
} from './representation.js';
import {
  commissionRefs,
  filingObligations,
  obligationReminders,
  rosterSnapshots,
} from './schema.js';
import { commissionRef, staffTenant } from './access.js';

/** The columns `toObligation` reads; select them from obligations left-joined to `commission_refs`. */
export const obligationColumns = {
  id: filingObligations.id,
  tenant: filingObligations.tenant,
  rosterRecordId: filingObligations.rosterRecordId,
  type: filingObligations.type,
  cycleKey: filingObligations.cycleKey,
  statementDate: filingObligations.statementDate,
  dueDate: filingObligations.dueDate,
  status: filingObligations.status,
  cancelReason: filingObligations.cancelReason,
  policyVersion: filingObligations.policyVersion,
  createdAt: filingObligations.createdAt,
  issuerCode: commissionRefs.issuerCode,
  commissionName: commissionRefs.name,
  remindersSent: sql<number>`(select count(*)::int from ${obligationReminders} where ${obligationReminders.obligationId} = ${filingObligations.id} and ${obligationReminders.outcome} = 'sent')`,
};

export type ObligationRow = Awaited<ReturnType<typeof selectObligations>>[number];

function selectObligations(tx: Transaction) {
  return tx
    .select(obligationColumns)
    .from(filingObligations)
    .leftJoin(commissionRefs, eq(commissionRefs.slug, filingObligations.tenant))
    .$dynamic();
}

/**
 * One obligation as read, with what the audit trail needs to know of the read (ADR-008): whether
 * the declarant read their own, and else whose data it is.
 */
export type ObligationRead =
  | { own: true; obligation: ObligationDetail }
  | {
      own: false;
      obligation: ObligationDetail;
      /** The obligation's Commission. */
      tenant: string;
      /** The person it is for, once linked; null before the declarant onboarded. */
      personId: string | null;
    };

/**
 * Reads of filing obligations (spec 04). A declarant reads by the person in their token across
 * Commissions (person-scoped RLS); staff read their own Commission's (tenant-scoped RLS). Anything
 * outside the caller's view is 404, as if it did not exist.
 */
@Injectable()
export class ObligationsService {
  constructor(@InjectDatabase() private readonly db: Database<DeclarationsSchema>) {}

  /**
   * The declarant's obligations, cancelled ones left out, grouped by Commission (by name), each
   * group overdue first then by due date. 404 without a `person_id` claim.
   */
  async mine(principal: Principal): Promise<MyObligations> {
    const personId = notFoundIfInvisible(principal.personId);
    const rows = await withPerson(this.db, { personId, subject: principal.subject }, (tx) =>
      selectObligations(tx)
        .where(
          and(eq(filingObligations.personId, personId), ne(filingObligations.status, 'cancelled')),
        )
        .orderBy(
          asc(commissionRefs.name),
          asc(filingObligations.tenant),
          desc(sql`${filingObligations.status} = 'overdue'`),
          asc(filingObligations.dueDate),
          asc(filingObligations.id),
        ),
    );
    const groups = new Map<string, MyObligations['groups'][number]>();
    for (const row of rows) {
      const obligation = toObligation(row);
      const group = groups.get(row.tenant);
      if (group) group.obligations.push(obligation);
      else groups.set(row.tenant, { commission: obligation.commission, obligations: [obligation] });
    }
    return { groups: [...groups.values()] };
  }

  /**
   * One obligation with its reminder history: the declarant's own (without `declarant`), or for
   * staff of its Commission and platform admins (with `declarant`, whom it is for). 404 for anyone else.
   */
  async one(principal: Principal, id: string): Promise<ObligationRead> {
    if (!UUID.test(id)) notFoundIfInvisible(null);
    if (principal.personId !== null) {
      const own = await withPerson(
        this.db,
        { personId: principal.personId, subject: principal.subject },
        (tx) => readDetail(tx, id, { declarant: false }),
      );
      if (own) return { own: true, obligation: own.obligation };
    }
    const tenant = staffTenant(principal);
    const read =
      tenant === null
        ? null
        : await withTenant(this.db, { tenant, subject: principal.subject }, (tx) =>
            readDetail(tx, id, { declarant: true }),
          );
    const { obligation, personId } = notFoundIfInvisible(read);
    return { own: false, obligation, tenant: obligation.commission.slug, personId };
  }
}

async function readDetail(
  tx: Transaction,
  id: string,
  { declarant }: { declarant: boolean },
): Promise<{ obligation: ObligationDetail; personId: string | null } | null> {
  const [row] = await tx
    .select({ ...obligationColumns, personId: filingObligations.personId })
    .from(filingObligations)
    .leftJoin(commissionRefs, eq(commissionRefs.slug, filingObligations.tenant))
    .where(eq(filingObligations.id, id))
    .limit(1);
  if (!row) return null;
  const reminders = await tx
    .select({
      offsetDays: obligationReminders.offsetDays,
      scheduledAt: obligationReminders.scheduledAt,
      sentAt: obligationReminders.sentAt,
      channels: obligationReminders.channels,
      outcome: obligationReminders.outcome,
    })
    .from(obligationReminders)
    .where(eq(obligationReminders.obligationId, id))
    .orderBy(asc(obligationReminders.scheduledAt), desc(obligationReminders.offsetDays));
  const obligation: ObligationDetail = {
    ...toObligation(row),
    reminders: reminders.map((reminder) => ({
      ...reminder,
      scheduledAt: reminder.scheduledAt.toISOString(),
      sentAt: reminder.sentAt?.toISOString() ?? null,
    })),
    declarant: declarant ? await readDeclarant(tx, row.rosterRecordId) : null,
  };
  return { obligation, personId: row.personId };
}

async function readDeclarant(
  tx: Transaction,
  rosterRecordId: string,
): Promise<DeclarantRef | null> {
  const [snapshot] = await tx
    .select({
      rosterRecordId: rosterSnapshots.rosterRecordId,
      personnelFileNumber: rosterSnapshots.personnelFileNumber,
      fullName: rosterSnapshots.fullName,
      personId: rosterSnapshots.personId,
      ofr: rosterSnapshots.ofr,
    })
    .from(rosterSnapshots)
    .where(eq(rosterSnapshots.rosterRecordId, rosterRecordId))
    .limit(1);
  if (!snapshot) return null;
  const { personId, ...declarant } = snapshot;
  return { ...declarant, onboarded: personId !== null };
}

export function toObligation(row: ObligationRow): Obligation {
  return {
    id: row.id,
    commission: commissionRef(row.tenant, {
      issuerCode: row.issuerCode,
      name: row.commissionName,
    }),
    type: row.type,
    cycleKey: row.cycleKey,
    statementDate: row.statementDate,
    dueDate: row.dueDate,
    status: row.status,
    cancelReason: row.cancelReason,
    remindersSent: row.remindersSent,
    policyVersion: row.policyVersion,
    createdAt: row.createdAt.toISOString(),
  };
}
