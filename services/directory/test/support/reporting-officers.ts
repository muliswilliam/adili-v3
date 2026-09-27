import { withTenant } from '@adili/data-access';
import { asc, eq, sql } from 'drizzle-orm';
import { expect } from 'vitest';

import { PLATFORM_TENANT } from '../../src/commissions/access.js';
import { commissions, outbox, reportingOfficerAssignments } from '../../src/db/schema.js';
import type { Caller, DirectoryApi } from './directory-api.js';

/** Helpers for the reporting officer suites (assign, replace, resend). */

export const PLATFORM_ADMIN: Caller = {
  sub: 'admin-1',
  tenant: 'platform',
  roles: ['platform-admin'],
};

export const ACTIVATION = {
  actions: ['VERIFY_EMAIL', 'UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
  lifespanSeconds: 259_200,
  redirectUri: 'http://localhost:3020/auth/login',
  clientId: 'console',
  commissionName: 'Teachers Service Commission',
  role: 'reporting-officer',
};

export interface Officer {
  name: string;
  email: string;
  phone: string;
}

export interface Problem {
  type: string;
  status: number;
  detail?: string;
  errors?: { path: string; message: string }[];
}

export interface CommissionBody {
  id: string;
  reportingOfficer: {
    id: string;
    name: string;
    email: string;
    phone: string;
    state: string;
    invitedAt: string;
    activatedAt: string | null;
  } | null;
}

/** Creates the Commission `tsc` over HTTP. */
export async function givenTsc(api: DirectoryApi): Promise<void> {
  const created = await api.post(
    '/v1/commissions',
    { slug: 'tsc', name: 'Teachers Service Commission', type: 'hosted', categories: [] },
    PLATFORM_ADMIN,
  );
  expect(created.statusCode).toBe(201);
}

/** `PUT /v1/commissions/tsc/reporting-officer` as the platform admin unless told otherwise. */
export function assign(
  api: DirectoryApi,
  officer: unknown,
  { caller = PLATFORM_ADMIN, key }: { caller?: Caller; key?: string } = {},
) {
  return api.put('/v1/commissions/tsc/reporting-officer', officer, caller, {
    idempotencyKey: key,
  });
}

/** Assigns an officer and returns the new assignment and the officer's account id. */
export async function givenOfficer(
  api: DirectoryApi,
  officer: Officer,
): Promise<{ assignmentId: string; userId: string }> {
  const response = await assign(api, officer);
  expect(response.statusCode).toBe(200);
  const assignmentId = response.json<CommissionBody>().reportingOfficer?.id ?? '';
  const [row] = await assignmentRows(api).then((rows) =>
    rows.filter((candidate) => candidate.id === assignmentId),
  );
  return { assignmentId, userId: row?.keycloakUserId ?? '' };
}

/**
 * Marks the current assignment activated, as the activation observer (#23) will once the
 * officer signs in. Arranged directly: there is no endpoint for it.
 */
export async function givenActivated(api: DirectoryApi, assignmentId: string): Promise<void> {
  await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
    tx
      .update(reportingOfficerAssignments)
      .set({ state: 'activated', activatedAt: new Date() })
      .where(eq(reportingOfficerAssignments.id, assignmentId)),
  );
}

/**
 * Every assignment of `tsc`, oldest first (ids are UUIDv7, made at insert). Replaced assignments are not in any response, so
 * S11 reads them from the table.
 */
export function assignmentRows(api: DirectoryApi) {
  return withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
    tx
      .select({
        id: reportingOfficerAssignments.id,
        email: reportingOfficerAssignments.email,
        keycloakUserId: reportingOfficerAssignments.keycloakUserId,
        state: reportingOfficerAssignments.state,
        replacedAt: reportingOfficerAssignments.replacedAt,
        replacedBy: reportingOfficerAssignments.replacedBy,
      })
      .from(reportingOfficerAssignments)
      .innerJoin(commissions, eq(commissions.id, reportingOfficerAssignments.commissionId))
      .where(eq(commissions.slug, 'tsc'))
      .orderBy(asc(reportingOfficerAssignments.id)),
  );
}

export async function officerOf(api: DirectoryApi) {
  return (await api.get('/v1/commissions/tsc', PLATFORM_ADMIN)).json<CommissionBody>()
    .reportingOfficer;
}

export async function assignedEvents(api: DirectoryApi) {
  return (
    await api.db.select({ type: outbox.eventType, envelope: outbox.envelope }).from(outbox)
  ).filter((event) => event.type === 'commission.reporting-officer.assigned.v1');
}

/**
 * Runs `work` while every outbox insert fails, as when recording an event fails after the
 * identity changes of an assignment were made.
 */
export async function withOutboxRefusing<T>(api: DirectoryApi, work: () => Promise<T>): Promise<T> {
  await api.db.execute(sql`
    create function refuse_outbox() returns trigger language plpgsql as $$
    begin raise exception 'outbox unavailable'; end $$`);
  await api.db.execute(sql`
    create trigger refuse_outbox before insert on outbox
    for each row execute function refuse_outbox()`);
  try {
    return await work();
  } finally {
    await api.db.execute(sql`drop trigger refuse_outbox on outbox`);
    await api.db.execute(sql`drop function refuse_outbox()`);
  }
}

/**
 * Runs `work` while another transaction holds the lock on the Commission `tsc`, as a slow
 * assignment of it would.
 */
export async function withTscLocked<T>(api: DirectoryApi, work: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const lockTaken = new Promise<void>((resolve) => (locked = resolve));
  const holder = withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, async (tx) => {
    await tx.select().from(commissions).where(eq(commissions.slug, 'tsc')).for('update');
    locked();
    await released;
  });
  await lockTaken;
  try {
    return await work();
  } finally {
    release();
    await holder;
  }
}
