import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  commissionRefs,
  declarationAttachments,
  declarations,
  filingObligations,
  outbox,
  rosterSnapshots,
} from '../../src/db/schema.js';
import type { Declaration, DeclarationListItem } from '../../src/drafts/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { rosterRecord } from '../support/fake-directory.js';
import { upload } from '../support/fake-documents.js';
import { assetItem, incomeItem } from '../fixtures/sections.js';

/**
 * Spec 05 S15 and S16 over HTTP: discarding a draft deletes its sections and attachments (an
 * unlink event for each) and leaves the obligation due, so a new start makes a fresh draft; the
 * declarant's list shows their live drafts with obligation, type, statement date and how much is
 * complete.
 */

const ACHIENG = randomUUID();
const OTIENO = randomUUID();
const declarant = (personId: string): Caller => ({ personId, sub: personId, roles: ['declarant'] });
const achieng = declarant(ACHIENG);
const reviewer: Caller = { tenant: 'psc', roles: ['reviewer'] };

const MINE_BODY = okResponse('/v1/me/declarations', 'get');

let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  await api.asPlatform(async (tx) => {
    await tx
      .insert(commissionRefs)
      .values({ slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' });
    await tx
      .insert(commissionRefs)
      .values({ slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' });
  });
});

interface Obligation {
  obligationId: string;
  tenant: string;
}

/** A due obligation of the person's, with its roster record in the fake directory. */
async function givenObligation({
  personId = ACHIENG,
  tenant = 'psc',
  type = 'biennial',
  statementDate = '2027-11-01',
}: {
  personId?: string;
  tenant?: string;
  type?: 'biennial' | 'final';
  statementDate?: string;
} = {}): Promise<Obligation> {
  const record = rosterRecord(tenant, { personId, fullName: 'Achieng Wambui Otieno' });
  api.directory.givenRecords([record]);
  const obligationId = randomUUID();
  await api.asPlatform(async (tx) => {
    await tx.insert(rosterSnapshots).values({
      rosterRecordId: record.id,
      tenant,
      personnelFileNumber: record.personnelFileNumber,
      fullName: record.fullName,
      state: 'onboarded',
      appointmentDate: record.appointmentDate,
      personId,
      sourceUpdatedAt: new Date(),
    });
    await tx.insert(filingObligations).values({
      id: obligationId,
      tenant,
      rosterRecordId: record.id,
      personId,
      type,
      cycleKey: `${type}:${statementDate.slice(0, 4)}`,
      statementDate,
      dueDate: '2027-12-31',
      status: 'due',
      policyVersionId: randomUUID(),
      policyVersion: 1,
      reminderOffsetsDays: [30, 14, 7],
    });
  });
  return { obligationId, tenant };
}

function start(obligationId: string, caller: Caller = achieng) {
  return api.request('POST', `/v1/obligations/${obligationId}/declaration`, caller);
}

async function started(obligation?: Obligation, caller: Caller = achieng): Promise<Declaration> {
  const { obligationId } = obligation ?? (await givenObligation());
  const response = await start(obligationId, caller);
  expect(response.statusCode).toBe(201);
  return response.json<Declaration>();
}

function discard(id: string, caller: Caller = achieng) {
  return api.request('DELETE', `/v1/declarations/${id}`, caller);
}

function mine(caller: Caller = achieng) {
  return api.request('GET', '/v1/me/declarations', caller);
}

async function saveStatement(id: string, version: number, caller: Caller = achieng) {
  const response = await api.request(
    'PUT',
    `/v1/declarations/${id}/sections/statement:officer`,
    caller,
    {
      headers: { 'if-match': `"${String(version)}"` },
      body: {
        incomeNil: false,
        income: [incomeItem()],
        assetsNil: false,
        assets: [assetItem()],
        liabilitiesNil: true,
        liabilities: [],
      },
    },
  );
  expect(response.statusCode).toBe(200);
}

async function eventsOf(type: string) {
  const rows = await api.db
    .select({ envelope: outbox.envelope })
    .from(outbox)
    .where(eq(outbox.eventType, type));
  return rows.map((row) => row.envelope);
}

describe('discarding a draft (S15)', () => {
  it('deletes sections and attachments with an unlink event each, and leaves the obligation due', async () => {
    const obligation = await givenObligation();
    const draft = await started(obligation);
    await saveStatement(draft.id, 1);
    const deed = upload('psc', ACHIENG);
    const logbook = upload('psc', ACHIENG);
    api.documents.givenUploads(deed, logbook);
    for (const [itemId, uploadId] of [
      [assetItem().id, deed.id],
      [incomeItem().id, logbook.id],
    ] as const) {
      const linked = await api.request(
        'POST',
        `/v1/declarations/${draft.id}/attachments`,
        achieng,
        {
          body: { sectionKey: 'statement:officer', itemId, uploadId },
        },
      );
      expect(linked.statusCode).toBe(201);
    }

    const response = await discard(draft.id);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    const [row] = await api.asPerson(ACHIENG, (tx) =>
      tx.select().from(declarations).where(eq(declarations.id, draft.id)),
    );
    expect(row?.status).toBe('discarded');
    const { rows: sections } = await api.asPerson(ACHIENG, (tx) =>
      tx.execute(sql`select 1 from declaration_sections where declaration_id = ${draft.id}`),
    );
    expect(sections).toEqual([]);
    expect(
      await api.asPerson(ACHIENG, (tx) =>
        tx
          .select()
          .from(declarationAttachments)
          .where(eq(declarationAttachments.declarationId, draft.id)),
      ),
    ).toEqual([]);

    // Linking recorded two unlinked events' worth of uploads; discard unlinks both.
    const unlinked = await eventsOf('declaration.attachment-unlinked.v1');
    expect(unlinked).toHaveLength(2);
    expect(api.documents.unlinked.sort()).toEqual([`psc ${deed.id}`, `psc ${logbook.id}`].sort());
    expect(unlinked.map((event) => (event as { data: unknown }).data)).toEqual(
      expect.arrayContaining([
        { declarationId: draft.id, uploadId: deed.id },
        { declarationId: draft.id, uploadId: logbook.id },
      ]),
    );
    expect(await eventsOf('declaration.draft-discarded.v1')).toEqual([
      expect.objectContaining({
        type: 'declaration.draft-discarded.v1',
        subject: draft.id,
        tenant: 'psc',
        data: { declarationId: draft.id },
      }),
    ]);

    const [obligationRow] = await api.asPlatform((tx) =>
      tx
        .select({ status: filingObligations.status })
        .from(filingObligations)
        .where(eq(filingObligations.id, obligation.obligationId)),
    );
    expect(obligationRow?.status).toBe('due');
  });

  it('is gone afterwards, and a new start makes a fresh draft', async () => {
    const obligation = await givenObligation();
    const draft = await started(obligation);
    await saveStatement(draft.id, 1);

    await discard(draft.id);

    expect((await api.request('GET', `/v1/declarations/${draft.id}`, achieng)).statusCode).toBe(
      404,
    );
    expect(
      (await api.request('GET', `/v1/declarations/${draft.id}/sections/statement:officer`, achieng))
        .statusCode,
    ).toBe(404);
    expect((await discard(draft.id)).statusCode).toBe(404);

    const again = await start(obligation.obligationId);
    expect(again.statusCode).toBe(201);
    const fresh = again.json<Declaration>();
    expect(fresh.id).not.toBe(draft.id);
    expect(fresh.draftVersion).toBe(1);
    expect(fresh.sections.map(({ key, completeness }) => [key, completeness])).toEqual([
      ['bio', 'not-started'],
      ['household', 'not-started'],
      ['statement:officer', 'not-started'],
      ['other', 'not-started'],
    ]);
  });

  it('is 404 for another person, staff and an unknown draft, and keeps the draft', async () => {
    const draft = await started();

    expect((await discard(draft.id, declarant(OTIENO))).statusCode).toBe(404);
    expect((await discard(draft.id, reviewer)).statusCode).toBe(404);
    expect((await discard(randomUUID())).statusCode).toBe(404);
    expect((await discard('not-a-uuid')).statusCode).toBe(404);
    expect((await api.request('GET', `/v1/declarations/${draft.id}`, achieng)).statusCode).toBe(
      200,
    );
  });

  it('refuses a declaration that is no longer a draft with 409', async () => {
    const draft = await started();
    await api.asPerson(ACHIENG, (tx) =>
      tx.update(declarations).set({ status: 'submitted' }).where(eq(declarations.id, draft.id)),
    );

    const response = await discard(draft.id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ type: 'declaration-not-draft', status: 409 });
    expect(await eventsOf('declaration.draft-discarded.v1')).toEqual([]);
  });
});

describe('my declarations (S16)', () => {
  it('lists my live drafts with obligation, type, statement date and completeness, newest first', async () => {
    const psc = await givenObligation();
    const tsc = await givenObligation({
      tenant: 'tsc',
      type: 'final',
      statementDate: '2027-06-30',
    });
    const gone = await givenObligation({ statementDate: '2025-11-01' });
    const discarded = await started(gone);
    await discard(discarded.id);
    const first = await started(psc);
    const second = await started(tsc);
    // One of the four live sections complete.
    await saveStatement(first.id, 1);
    await started(await givenObligation({ personId: OTIENO }), declarant(OTIENO));

    const response = await mine();

    expect(response.statusCode).toBe(200);
    const list = response.json<DeclarationListItem[]>();
    expect(contractErrors(MINE_BODY, list)).toEqual([]);
    expect(list).toEqual([
      {
        id: first.id,
        obligationId: psc.obligationId,
        commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
        type: 'biennial',
        statementDate: '2027-11-01',
        status: 'draft',
        completenessPercent: 25,
        dueDate: '2027-12-31',
        reference: null,
        currentVersion: null,
        amendingFromVersion: null,
        submittedAt: null,
        late: null,
        amendable: false,
        acknowledgement: null,
        updatedAt: expect.any(String) as string,
      },
      {
        id: second.id,
        obligationId: tsc.obligationId,
        commission: { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' },
        type: 'final',
        statementDate: '2027-06-30',
        status: 'draft',
        completenessPercent: 0,
        dueDate: '2027-12-31',
        reference: null,
        currentVersion: null,
        amendingFromVersion: null,
        submittedAt: null,
        late: null,
        amendable: false,
        acknowledgement: null,
        updatedAt: second.updatedAt,
      },
    ]);
    expect(Date.parse(list[0]?.updatedAt ?? '')).toBeGreaterThan(Date.parse(second.updatedAt));
  });

  it('counts only live sections: an archived statement is left out', async () => {
    const draft = await started();
    await saveStatement(draft.id, 1);
    const spouseId = randomUUID();
    const household = (spouses: unknown[]) => ({
      spouses: { none: spouses.length === 0, items: spouses },
      children: { none: true, items: [] },
    });
    const put = (version: number, body: unknown) =>
      api.request('PUT', `/v1/declarations/${draft.id}/sections/household`, achieng, {
        headers: { 'if-match': `"${String(version)}"` },
        body,
      });
    await put(
      2,
      household([{ id: spouseId, name: { surname: 'O', firstName: 'G' }, separated: false }]),
    );
    // Live: bio, household (complete), statement:officer (complete), spouse, other: 2 of 5.
    expect((await mine()).json<DeclarationListItem[]>()[0]?.completenessPercent).toBe(40);

    await put(3, household([]));

    // Live: bio, household (complete), statement:officer (complete), other: 2 of 4.
    expect((await mine()).json<DeclarationListItem[]>()[0]?.completenessPercent).toBe(50);
  });

  it('is empty for a declarant with no drafts, and 404 for staff', async () => {
    const empty = await mine(declarant(OTIENO));
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual([]);
    expect((await mine(reviewer)).statusCode).toBe(404);
  });
});
