import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase, withPerson, withTenant } from '@adili/data-access';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';

import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from './apply-page.js';
import type {
  CommissionRef,
  MyObligations,
  Obligation,
  ObligationDetail,
  OfficerRef,
} from './representation.js';
import {
  commissionRefs,
  filingObligations,
  obligationReminders,
  rosterSnapshots,
} from './schema.js';

/** Roles of a Commission's staff, who see their own Commission's obligations. */
export const COMMISSION_STAFF_ROLES = [
  'reporting-officer',
  'reviewer',
  'supervisor',
  'commission-admin',
] as const;

export const PLATFORM_ADMIN = 'platform-admin';
/** `app.tenant` of reads across every Commission. */
export const PLATFORM_TENANT = 'platform';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
   * One obligation with its reminder history: the declarant's own (without the officer), or for
   * staff of its Commission and platform admins (with the officer). 404 for anyone else.
   */
  async one(principal: Principal, id: string): Promise<ObligationDetail> {
    if (!UUID.test(id)) notFoundIfInvisible(null);
    if (principal.personId !== null) {
      const detail = await withPerson(
        this.db,
        { personId: principal.personId, subject: principal.subject },
        (tx) => readDetail(tx, id, { officer: false }),
      );
      if (detail) return detail;
    }
    const tenant = staffTenantOf(principal);
    const detail =
      tenant === null
        ? null
        : await withTenant(this.db, { tenant, subject: principal.subject }, (tx) =>
            readDetail(tx, id, { officer: true }),
          );
    return notFoundIfInvisible(detail);
  }
}

/** The tenant whose obligations a staff caller sees: `platform` (all) for platform admins. */
function staffTenantOf(principal: Principal): string | null {
  if (principal.roles.includes(PLATFORM_ADMIN)) return PLATFORM_TENANT;
  const staff = principal.roles.some((role) =>
    (COMMISSION_STAFF_ROLES as readonly string[]).includes(role),
  );
  return staff && principal.tenant !== null && principal.tenant !== PLATFORM_TENANT
    ? principal.tenant
    : null;
}

async function readDetail(
  tx: Transaction,
  id: string,
  { officer }: { officer: boolean },
): Promise<ObligationDetail | null> {
  const [row] = await selectObligations(tx).where(eq(filingObligations.id, id)).limit(1);
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
  return {
    ...toObligation(row),
    reminders: reminders.map((reminder) => ({
      ...reminder,
      scheduledAt: reminder.scheduledAt.toISOString(),
      sentAt: reminder.sentAt?.toISOString() ?? null,
    })),
    officer: officer ? await readOfficer(tx, row.rosterRecordId) : null,
  };
}

async function readOfficer(tx: Transaction, rosterRecordId: string): Promise<OfficerRef | null> {
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
  const { personId, ...officer } = snapshot;
  return { ...officer, onboarded: personId !== null };
}

export function toObligation(row: ObligationRow): Obligation {
  return {
    id: row.id,
    commission: commissionOf(row),
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

/** The Commission as last pulled; its issuer code alone until a pull has named it. */
function commissionOf(row: ObligationRow): CommissionRef {
  const issuerCode = row.issuerCode ?? row.tenant.toUpperCase();
  return { slug: row.tenant, issuerCode, name: row.commissionName ?? issuerCode };
}
