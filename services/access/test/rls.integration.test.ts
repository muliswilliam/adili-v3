import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  accessRegister,
  accessRequests,
  certifiedCopies,
  leaRequests,
  representations,
} from '../src/db/schema.js';
import type { AccessTransaction } from '../src/db/database.js';
import { type AccessApi, startAccessApi } from './support/access-api.js';

/**
 * Row-level security of the access database (migration 0002_access_rls): officers see their
 * Commission's rows, applicants their own requests, declarants what is about them once they may
 * know of it, law enforcement officers the requests they filed. Exercised directly in the
 * contexts the service opens (`withTenant`, `withPerson`), as FORCE applies the policies to the
 * owning role.
 */
describe('access row-level security', () => {
  let api: AccessApi;

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  const scope = {
    years: [2026],
    includeSpouses: false,
    includeChildren: false,
    sections: ['assets' as const],
  };
  let sequence = 0;

  async function givenRequest(
    fields: Partial<typeof accessRequests.$inferInsert> = {},
  ): Promise<typeof accessRequests.$inferSelect> {
    sequence += 1;
    const tenant = fields.tenant ?? 'psc';
    const id = randomUUID();
    const reference = `ARQ-${tenant.toUpperCase()}-2026-${String(sequence).padStart(7, '0')}-X`;
    return api.asPlatform(async (tx) => {
      const [row] = await tx
        .insert(accessRequests)
        .values({
          id,
          tenant,
          commissionName: 'Commission',
          reference,
          applicantPersonId: randomUUID(),
          applicantSubject: 'applicant',
          applicantName: 'Applicant',
          applicantIdentityStatus: 'verified',
          formKCiphertext: 'sealed',
          formKEnvelope: {
            v: 1,
            tenant,
            iv: 'iv',
            tag: 'tag',
            wrappedDek: 'dek',
            keyVersion: 1,
          },
          officerSought: { name: 'Officer', entity: 'Entity', workStation: '' },
          scope,
          status: 'submitted',
          submittedAt: new Date(),
          decisionDeadlineAt: new Date(),
          ...fields,
        })
        .returning();
      await entry(tx, { tenant, subjectKind: 'access-request', subjectId: id, reference });
      if (!row) throw new Error('not inserted');
      return row;
    });
  }

  async function givenLeaRequest(
    fields: Partial<typeof leaRequests.$inferInsert> = {},
  ): Promise<typeof leaRequests.$inferSelect> {
    sequence += 1;
    const tenant = fields.tenant ?? 'psc';
    const id = randomUUID();
    const reference = `LEA-${tenant.toUpperCase()}-2026-${String(sequence).padStart(7, '0')}-X`;
    return api.asPlatform(async (tx) => {
      const [row] = await tx
        .insert(leaRequests)
        .values({
          id,
          tenant,
          commissionName: 'Commission',
          reference,
          officerSubject: 'lea-officer-a',
          officerPersonId: randomUUID(),
          officerName: 'Officer A',
          agencyCode: 'DCI',
          agencyName: 'Directorate of Criminal Investigations',
          provenance: {
            accountState: 'activated',
            activatedAt: null,
            agencyLegalBasis: 'National Police Service Act, 2011, s.35',
            checkedAt: new Date().toISOString(),
          },
          officerSought: { name: 'Officer' },
          reason: 'Investigation',
          caseReference: 'CR-1',
          scope,
          status: 'received',
          receivedAt: new Date(),
          deadlineAt: new Date(),
          ...fields,
        })
        .returning();
      await entry(tx, { tenant, subjectKind: 'lea-request', subjectId: id, reference });
      if (!row) throw new Error('not inserted');
      return row;
    });
  }

  async function entry(
    tx: AccessTransaction,
    fields: Pick<
      typeof accessRegister.$inferInsert,
      'tenant' | 'subjectKind' | 'subjectId' | 'reference'
    > &
      Partial<typeof accessRegister.$inferInsert>,
  ): Promise<void> {
    await tx.insert(accessRegister).values({
      id: randomUUID(),
      personId: null,
      kind: 'received',
      actor: null,
      legalBasis: 'act-s36-1',
      at: new Date(),
      ...fields,
    });
  }

  const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id).sort();

  /** The SQLSTATE a refused statement failed with (42501: refused by row-level security). */
  async function refusal(work: Promise<unknown>): Promise<string | undefined> {
    try {
      await work;
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause;
      return cause?.code ?? (error as { code?: string }).code;
    }
    return undefined;
  }

  it("officers see their own Commission's requests and entries only", async () => {
    const psc = await givenRequest({ tenant: 'psc' });
    const tsc = await givenRequest({ tenant: 'tsc' });
    const lea = await givenLeaRequest({ tenant: 'psc' });

    const seen = await api.asTenant({ tenant: 'psc', subject: 'officer' }, async (tx) => ({
      requests: await tx.select().from(accessRequests),
      lea: await tx.select().from(leaRequests),
      entries: await tx.select().from(accessRegister),
    }));

    expect(ids(seen.requests)).toEqual([psc.id]);
    expect(ids(seen.lea)).toEqual([lea.id]);
    expect(seen.entries.map((row) => row.subjectId).sort()).toEqual([psc.id, lea.id].sort());
    const other = await api.asTenant({ tenant: 'tsc', subject: 'officer' }, (tx) =>
      tx.select().from(accessRequests),
    );
    expect(ids(other)).toEqual([tsc.id]);
  });

  it("an officer cannot write another Commission's request", async () => {
    const code = await refusal(
      api.asTenant({ tenant: 'tsc', subject: 'officer' }, async (tx) => {
        await tx.insert(accessRequests).values({
          id: randomUUID(),
          tenant: 'psc',
          commissionName: 'PSC',
          reference: 'ARQ-PSC-2026-0000099-X',
          applicantPersonId: randomUUID(),
          applicantSubject: 'applicant',
          applicantName: 'Applicant',
          applicantIdentityStatus: 'verified',
          formKCiphertext: 'sealed',
          formKEnvelope: { v: 1, tenant: 'psc', iv: '', tag: '', wrappedDek: '', keyVersion: 1 },
          officerSought: { name: 'Officer', entity: 'Entity', workStation: '' },
          scope,
          status: 'submitted',
          submittedAt: new Date(),
          decisionDeadlineAt: new Date(),
        });
      }),
    );

    expect(code).toBe('42501');
  });

  it('nothing is visible outside a context', async () => {
    await givenRequest();
    await givenLeaRequest();

    expect(await api.db.select().from(accessRequests)).toEqual([]);
    expect(await api.db.select().from(leaRequests)).toEqual([]);
    expect(await api.db.select().from(accessRegister)).toEqual([]);
  });

  it('an applicant reads their own requests across Commissions, with their entries, and nobody else', async () => {
    const applicant = randomUUID();
    const psc = await givenRequest({ tenant: 'psc', applicantPersonId: applicant });
    const tsc = await givenRequest({ tenant: 'tsc', applicantPersonId: applicant });
    await givenRequest({ tenant: 'psc' });

    const seen = await api.asPerson(applicant, async (tx) => ({
      requests: await tx.select().from(accessRequests),
      entries: await tx.select().from(accessRegister),
    }));

    expect(ids(seen.requests)).toEqual([psc.id, tsc.id].sort());
    expect(seen.entries.map((row) => row.subjectId).sort()).toEqual([psc.id, tsc.id].sort());
    expect(await api.asPerson(randomUUID(), (tx) => tx.select().from(accessRequests))).toEqual([]);
  });

  it('a declarant reads a request about them only once notified, with its entries', async () => {
    const declarant = randomUUID();
    const request = await givenRequest({
      resolvedPersonId: declarant,
      status: 'officer-unresolved',
    });

    const before = await api.asPerson(declarant, async (tx) => ({
      requests: await tx.select().from(accessRequests),
      entries: await tx.select().from(accessRegister),
    }));
    expect(before).toEqual({ requests: [], entries: [] });

    await api.asPlatform((tx) =>
      tx
        .update(accessRequests)
        .set({ notifiedAt: new Date(), status: 'awaiting-representations' })
        .where(eq(accessRequests.id, request.id)),
    );
    const after = await api.asPerson(declarant, async (tx) => ({
      requests: await tx.select().from(accessRequests),
      entries: await tx.select().from(accessRegister),
    }));
    expect(ids(after.requests)).toEqual([request.id]);
    expect(after.entries.map((row) => row.subjectId)).toEqual([request.id]);
    expect(await api.asPerson(randomUUID(), (tx) => tx.select().from(accessRequests))).toEqual([]);
  });

  it('the notified declarant writes their representations; nobody else can, and the applicant cannot read them', async () => {
    const declarant = randomUUID();
    const applicant = randomUUID();
    const request = await givenRequest({
      applicantPersonId: applicant,
      resolvedPersonId: declarant,
      notifiedAt: new Date(),
      status: 'awaiting-representations',
    });
    const notYetNotified = await givenRequest({ resolvedPersonId: declarant });
    const representation = (requestId: string, personId: string) => ({
      requestId,
      tenant: 'psc',
      personId,
      stance: 'object' as const,
      text: 'I object.',
      submittedAt: new Date(),
    });

    await api.asPerson(declarant, (tx) =>
      tx.insert(representations).values(representation(request.id, declarant)),
    );
    const updated = await api.asPerson(declarant, (tx) =>
      tx
        .update(representations)
        .set({ stance: 'context', text: 'Some context.' })
        .where(eq(representations.requestId, request.id))
        .returning(),
    );
    expect(updated).toHaveLength(1);

    const other = randomUUID();
    expect(
      await refusal(
        api.asPerson(other, (tx) =>
          tx.insert(representations).values(representation(request.id, other)),
        ),
      ),
    ).toBe('42501');
    expect(
      await refusal(
        api.asPerson(declarant, (tx) =>
          tx.insert(representations).values(representation(notYetNotified.id, declarant)),
        ),
      ),
    ).toBe('42501');
    expect(await api.asPerson(applicant, (tx) => tx.select().from(representations))).toEqual([]);
    expect(
      await api.asTenant({ tenant: 'psc', subject: 'officer' }, (tx) =>
        tx.select().from(representations),
      ),
    ).toHaveLength(1);
  });

  it("a declarant's save (an upsert under their person context, as the service makes it) cannot reach another declarant's representations of the same Commission", async () => {
    const anne = randomUUID();
    const brian = randomUUID();
    const aboutAnne = await givenRequest({
      resolvedPersonId: anne,
      notifiedAt: new Date(),
      status: 'awaiting-representations',
    });
    // Brian is a notified declarant of the same Commission: its policy would admit him.
    await givenRequest({
      resolvedPersonId: brian,
      notifiedAt: new Date(),
      status: 'awaiting-representations',
    });
    const values = (personId: string) => ({
      requestId: aboutAnne.id,
      tenant: 'psc',
      personId,
      stance: 'object' as const,
      text: 'I object.',
      submittedAt: new Date(),
    });
    await api.asPerson(anne, (tx) => tx.insert(representations).values(values(anne)));

    for (const personId of [brian, anne]) {
      expect(
        await refusal(
          api.asPerson(brian, (tx) =>
            tx
              .insert(representations)
              .values(values(personId))
              .onConflictDoUpdate({
                target: representations.requestId,
                set: { stance: 'consent', text: 'Consented.' },
              }),
          ),
        ),
      ).toBe('42501');
    }
    const changed = await api.asPerson(brian, (tx) =>
      tx
        .update(representations)
        .set({ stance: 'consent' })
        .where(eq(representations.requestId, aboutAnne.id))
        .returning(),
    );
    expect(changed).toEqual([]);
    const [kept] = await api.asPlatform((tx) => tx.select().from(representations));
    expect(kept).toMatchObject({ personId: anne, stance: 'object' });
  });

  it('a law enforcement officer reads the requests they filed only, with their entries', async () => {
    const mine = await givenLeaRequest({ tenant: 'psc', officerSubject: 'lea-officer-a' });
    const mineElsewhere = await givenLeaRequest({ tenant: 'tsc', officerSubject: 'lea-officer-a' });
    await givenLeaRequest({ tenant: 'psc', officerSubject: 'lea-officer-b' });
    await givenRequest({ tenant: 'psc' });

    const seen = await api.asTenant({ tenant: 'lea', subject: 'lea-officer-a' }, async (tx) => ({
      lea: await tx.select().from(leaRequests),
      requests: await tx.select().from(accessRequests),
      entries: await tx.select().from(accessRegister),
    }));

    expect(ids(seen.lea)).toEqual([mine.id, mineElsewhere.id].sort());
    expect(seen.requests).toEqual([]);
    expect(seen.entries.map((row) => row.subjectId).sort()).toEqual(
      [mine.id, mineElsewhere.id].sort(),
    );
    // The officer's subject outside the `lea` tenant sees nothing of theirs.
    expect(
      await api.asTenant({ tenant: 'eacc', subject: 'lea-officer-a' }, (tx) =>
        tx.select().from(leaRequests),
      ),
    ).toEqual([]);
  });

  it('a declarant sees a law enforcement request about them only once granted (r.23(2))', async () => {
    const declarant = randomUUID();
    const request = await givenLeaRequest({ resolvedPersonId: declarant, status: 'verified' });

    const before = await api.asPerson(declarant, async (tx) => ({
      lea: await tx.select().from(leaRequests),
      entries: await tx.select().from(accessRegister),
    }));
    expect(before).toEqual({ lea: [], entries: [] });

    await api.asPlatform((tx) =>
      tx.update(leaRequests).set({ status: 'granted' }).where(eq(leaRequests.id, request.id)),
    );
    const after = await api.asPerson(declarant, async (tx) => ({
      lea: await tx.select().from(leaRequests),
      entries: await tx.select().from(accessRegister),
    }));
    expect(ids(after.lea)).toEqual([request.id]);
    expect(after.entries.map((row) => row.subjectId)).toEqual([request.id]);
  });

  it('a declarant reads their own certified copies and self-access entries only', async () => {
    const declarant = randomUUID();
    const copy = randomUUID();
    await api.asPlatform(async (tx) => {
      for (const [id, personId] of [
        [copy, declarant],
        [randomUUID(), randomUUID()],
      ] as const) {
        await tx.insert(certifiedCopies).values({
          id,
          tenant: 'psc',
          commissionName: 'Public Service Commission',
          personId,
          declarationId: randomUUID(),
          version: 1,
          status: 'pending',
          requestedBy: 'declarant',
          requestedAt: new Date(),
        });
        await entry(tx, {
          tenant: 'psc',
          subjectKind: 'self-access',
          subjectId: id,
          reference: null,
          personId,
          kind: 'self-access',
          legalBasis: 'self-access',
        });
      }
    });

    const seen = await api.asPerson(declarant, async (tx) => ({
      copies: await tx.select().from(certifiedCopies),
      entries: await tx.select().from(accessRegister),
    }));

    expect(ids(seen.copies)).toEqual([copy]);
    expect(seen.entries.map((row) => row.subjectId)).toEqual([copy]);
  });

  it('register entries can never be changed or removed', async () => {
    const request = await givenRequest();

    expect(
      await refusal(
        api.asPlatform((tx) =>
          tx
            .update(accessRegister)
            .set({ kind: 'withdrawn' })
            .where(eq(accessRegister.subjectId, request.id)),
        ),
      ),
    ).toBe('42501');
    expect(
      await refusal(
        api.asPlatform((tx) =>
          tx.delete(accessRegister).where(eq(accessRegister.subjectId, request.id)),
        ),
      ),
    ).toBe('42501');
    const entries = await api.asPlatform((tx) => tx.select().from(accessRegister));
    expect(entries).toEqual([expect.objectContaining({ subjectId: request.id, kind: 'received' })]);
  });
});
