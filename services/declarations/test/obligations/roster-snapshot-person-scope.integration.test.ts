import { randomUUID } from 'node:crypto';

import { withPerson, withTenant } from '@adili/data-access';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { rosterSnapshots } from '../../src/db/schema.js';
import { type DeclarationsApi, startDeclarationsApi } from '../support/declarations-api.js';

/**
 * ADR-018 on `roster_snapshots` (migration 0010): a declarant reads their own snapshots across
 * Commissions through `app.person`, never another person's, and never writes; staff and system
 * transactions keep their tenant scope.
 */
let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
  return () => api.close();
});

const WANJIRU = randomUUID();
const OTIENO = randomUUID();

const snapshot = (tenant: string, personId: string | null, fullName: string) => ({
  rosterRecordId: randomUUID(),
  tenant,
  personnelFileNumber: `PF-${fullName}`,
  fullName,
  state: personId ? ('onboarded' as const) : ('not_onboarded' as const),
  personId,
  sourceUpdatedAt: new Date('2027-07-01T00:00:00Z'),
});

/** Wanjiru is on the PSC and TSC rosters, Otieno on PSC's; a PSC record has not onboarded. */
beforeEach(async () => {
  await api.reset();
  await api.asPlatform((tx) =>
    tx
      .insert(rosterSnapshots)
      .values([
        snapshot('psc', WANJIRU, 'Wanjiru at PSC'),
        snapshot('tsc', WANJIRU, 'Wanjiru at TSC'),
        snapshot('psc', OTIENO, 'Otieno'),
        snapshot('psc', null, 'Not onboarded'),
      ]),
  );
});

describe('roster_snapshots under the person axis', () => {
  it('shows a declarant only their own snapshots, across Commissions', async () => {
    const rows = await withPerson(api.db, { personId: WANJIRU, subject: 'test' }, (tx) =>
      tx
        .select({ tenant: rosterSnapshots.tenant, fullName: rosterSnapshots.fullName })
        .from(rosterSnapshots),
    );

    expect(rows.map((row) => row.fullName).sort()).toEqual(['Wanjiru at PSC', 'Wanjiru at TSC']);
    expect(rows.map((row) => row.tenant).sort()).toEqual(['psc', 'tsc']);
  });

  it('refuses a declarant any write, even to their own snapshots', async () => {
    // No policy admits an update or delete here, so they match no row; an insert is refused.
    await expect(
      withPerson(api.db, { personId: WANJIRU, subject: 'test' }, (tx) =>
        tx
          .update(rosterSnapshots)
          .set({ fullName: 'Changed' })
          .where(eq(rosterSnapshots.personId, WANJIRU))
          .returning({ id: rosterSnapshots.rosterRecordId }),
      ),
    ).resolves.toEqual([]);
    await expect(
      withPerson(api.db, { personId: WANJIRU, subject: 'test' }, (tx) =>
        tx
          .delete(rosterSnapshots)
          .where(eq(rosterSnapshots.personId, WANJIRU))
          .returning({ id: rosterSnapshots.rosterRecordId }),
      ),
    ).resolves.toEqual([]);
    await expect(
      withPerson(api.db, { personId: WANJIRU, subject: 'test' }, (tx) =>
        tx.insert(rosterSnapshots).values(snapshot('psc', WANJIRU, 'Inserted')),
      ),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/row-level security/) as unknown },
    });
    const names = await api.asPlatform((tx) =>
      tx.select({ fullName: rosterSnapshots.fullName }).from(rosterSnapshots),
    );
    expect(names.map((row) => row.fullName).sort()).toEqual([
      'Not onboarded',
      'Otieno',
      'Wanjiru at PSC',
      'Wanjiru at TSC',
    ]);
  });

  it("keeps staff to their tenant's snapshots, whoever they belong to", async () => {
    const psc = await withTenant(api.db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.select({ fullName: rosterSnapshots.fullName }).from(rosterSnapshots),
    );
    const write = withTenant(api.db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.execute(sql`update ${rosterSnapshots} set tenant = 'kra' where tenant = 'psc'`),
    );

    expect(psc.map((row) => row.fullName).sort()).toEqual([
      'Not onboarded',
      'Otieno',
      'Wanjiru at PSC',
    ]);
    await expect(write).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/row-level security/) as unknown },
    });
  });

  it('shows a transaction with neither tenant nor person nothing', async () => {
    const rows = await api.db.select({ id: rosterSnapshots.rosterRecordId }).from(rosterSnapshots);

    expect(rows).toEqual([]);
  });
});
