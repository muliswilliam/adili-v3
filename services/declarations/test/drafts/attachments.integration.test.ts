import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  commissionRefs,
  declarationAttachments,
  filingObligations,
  outbox,
  rosterSnapshots,
} from '../../src/db/schema.js';
import type {
  Declaration,
  DeclarationAttachment,
  SectionEnvelope,
} from '../../src/drafts/representation.js';
import { contractErrors } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { rosterRecord } from '../support/fake-directory.js';
import { upload } from '../support/fake-documents.js';
import { assetItem, incomeItem } from '../fixtures/sections.js';

/**
 * Spec 05 S10 over HTTP: a declarant links a clean upload (purpose `declaration-attachment`,
 * verified through the documents internal API, faked here) to an item of a statement, and unlinks
 * it. The row keeps name, hash and size; the reference lives in the item inside the encrypted
 * statement; each change bumps the draft version and records an event with identifiers only.
 */

const ACHIENG = randomUUID();
const OTIENO = randomUUID();
const declarant = (personId: string): Caller => ({ personId, roles: ['declarant'] });
const STATEMENT = 'statement:officer';
const ASSET_ID = assetItem().id;

const LINK_BODY =
  '/paths/~1v1~1declarations~1{declarationId}~1attachments/post/responses/201/content/application~1json/schema';

let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  await api.asPlatform((tx) =>
    tx
      .insert(commissionRefs)
      .values({ slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' }),
  );
});

/** A PSC declarant's draft whose officer statement has one income and one asset item (version 2). */
async function draftWithItems(personId = ACHIENG): Promise<Declaration> {
  const record = rosterRecord('psc', { personId, fullName: 'Achieng Wambui Otieno' });
  api.directory.givenRecords([record]);
  const obligationId = randomUUID();
  await api.asPlatform(async (tx) => {
    await tx.insert(rosterSnapshots).values({
      rosterRecordId: record.id,
      tenant: 'psc',
      personnelFileNumber: record.personnelFileNumber,
      fullName: record.fullName,
      state: 'onboarded',
      appointmentDate: record.appointmentDate,
      personId,
      sourceUpdatedAt: new Date(),
    });
    await tx.insert(filingObligations).values({
      id: obligationId,
      tenant: 'psc',
      rosterRecordId: record.id,
      personId,
      type: 'biennial',
      cycleKey: 'biennial:2027',
      statementDate: '2027-11-01',
      dueDate: '2027-12-31',
      status: 'due',
      policyVersionId: randomUUID(),
      policyVersion: 1,
      reminderOffsetsDays: [30, 14, 7],
    });
  });
  const started = await api.request(
    'POST',
    `/v1/obligations/${obligationId}/declaration`,
    declarant(personId),
  );
  expect(started.statusCode).toBe(201);
  const draft = started.json<Declaration>();
  const saved = await saveStatement(draft.id, statementBody(), '"1"', personId);
  expect(saved.statusCode).toBe(200);
  return { ...draft, draftVersion: 2 };
}

function statementBody(overrides: Record<string, unknown> = {}) {
  return {
    incomeNil: false,
    income: [incomeItem()],
    assetsNil: false,
    assets: [assetItem()],
    liabilitiesNil: true,
    liabilities: [],
    ...overrides,
  };
}

function saveStatement(id: string, body: unknown, ifMatch: string, personId = ACHIENG) {
  return api.request('PUT', `/v1/declarations/${id}/sections/${STATEMENT}`, declarant(personId), {
    headers: { 'if-match': ifMatch },
    body,
  });
}

function link(id: string, body: Record<string, unknown>, caller: Caller = declarant(ACHIENG)) {
  return api.request('POST', `/v1/declarations/${id}/attachments`, caller, { body });
}

function unlink(id: string, attachmentId: string, caller: Caller = declarant(ACHIENG)) {
  return api.request('DELETE', `/v1/declarations/${id}/attachments/${attachmentId}`, caller);
}

async function statement(id: string): Promise<SectionEnvelope> {
  return (
    await api.request('GET', `/v1/declarations/${id}/sections/${STATEMENT}`, declarant(ACHIENG))
  ).json<SectionEnvelope>();
}

function itemOf(section: SectionEnvelope, list: string, id: string): Record<string, unknown> {
  const items = section.contents[list] as Record<string, unknown>[];
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`no ${list} item ${id}`);
  return item;
}

async function attachmentRows(declarationId: string) {
  return api.asPerson(ACHIENG, (tx) =>
    tx
      .select()
      .from(declarationAttachments)
      .where(eq(declarationAttachments.declarationId, declarationId)),
  );
}

async function events(type: string) {
  return api.db
    .select({ envelope: outbox.envelope })
    .from(outbox)
    .where(eq(outbox.eventType, type));
}

describe('linking an attachment (S10)', () => {
  it('links a clean declaration attachment to an item: row with hash, reference in the item, event', async () => {
    const draft = await draftWithItems();
    const deed = upload('psc', { fileName: 'title-deed-kisumu.pdf', size: 1_204_551 });
    api.documents.givenUploads(deed);
    api.clock.setToday('2027-10-15');

    const response = await link(draft.id, {
      sectionKey: STATEMENT,
      itemId: ASSET_ID,
      uploadId: deed.id,
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.etag).toBe('"3"');
    const attachment = response.json<DeclarationAttachment>();
    expect(contractErrors(LINK_BODY, attachment)).toEqual([]);
    expect(attachment).toMatchObject({
      sectionKey: STATEMENT,
      itemId: ASSET_ID,
      uploadId: deed.id,
      fileName: 'title-deed-kisumu.pdf',
      sha256: deed.sha256,
      size: 1_204_551,
      linkedAt: '2027-10-15T09:00:00.000Z',
    });
    const header = (
      await api.request('GET', `/v1/declarations/${draft.id}`, declarant(ACHIENG))
    ).json<Declaration>();
    expect(header.sections.find((section) => section.key === STATEMENT)?.updatedAt).toBe(
      '2027-10-15T09:00:00.000Z',
    );

    const rows = await attachmentRows(draft.id);
    expect(rows).toEqual([
      {
        id: attachment.id,
        declarationId: draft.id,
        sectionKey: STATEMENT,
        itemId: ASSET_ID,
        uploadId: deed.id,
        sha256: deed.sha256,
        size: 1_204_551,
        linkedAt: expect.any(Date) as Date,
      },
    ]);
    const section = await statement(draft.id);
    expect(section.draftVersion).toBe(3);
    // declaration.v1's Attachment: the link's id, which unlinking takes.
    expect(itemOf(section, 'assets', ASSET_ID).attachments).toEqual([
      {
        attachmentId: attachment.id,
        uploadId: deed.id,
        fileName: 'title-deed-kisumu.pdf',
        sha256: deed.sha256,
      },
    ]);
    expect(itemOf(section, 'income', incomeItem().id)).not.toHaveProperty('attachments');
    expect(section.completeness).toBe('complete');
    expect(api.documents.linked).toEqual([`psc ${deed.id}`]);

    const linked = await events('declaration.attachment-linked.v1');
    expect(linked.map((event) => event.envelope)).toEqual([
      expect.objectContaining({
        subject: draft.id,
        tenant: 'psc',
        data: { declarationId: draft.id, uploadId: deed.id },
      }),
    ]);
    expect(JSON.stringify(linked)).not.toContain('title-deed');
  });

  it('refuses an infected upload with 409 and changes nothing', async () => {
    const draft = await draftWithItems();
    const infected = upload('psc', { state: 'infected' });
    api.documents.givenUploads(infected);

    const response = await link(draft.id, {
      sectionKey: STATEMENT,
      itemId: ASSET_ID,
      uploadId: infected.id,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ type: 'upload-not-clean' });
    expect(await attachmentRows(draft.id)).toEqual([]);
    expect(api.documents.linked).toEqual([]);
    expect((await statement(draft.id)).draftVersion).toBe(2);
    expect(await events('declaration.attachment-linked.v1')).toEqual([]);
  });

  it('refuses an upload of another purpose with 409', async () => {
    const draft = await draftWithItems();
    const roster = upload('psc', { purpose: 'roster-import', fileName: 'roster.csv' });
    api.documents.givenUploads(roster);

    const response = await link(draft.id, {
      sectionKey: STATEMENT,
      itemId: ASSET_ID,
      uploadId: roster.id,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ type: 'upload-wrong-purpose' });
    expect(await attachmentRows(draft.id)).toEqual([]);
    expect(api.documents.linked).toEqual([]);
  });

  it("refuses another Commission's upload, or an unknown one, with 409", async () => {
    const draft = await draftWithItems();
    const theirs = upload('tsc');
    api.documents.givenUploads(theirs);

    for (const uploadId of [theirs.id, randomUUID()]) {
      const response = await link(draft.id, { sectionKey: STATEMENT, itemId: ASSET_ID, uploadId });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ type: 'upload-not-found' });
    }
    expect(await attachmentRows(draft.id)).toEqual([]);
  });

  it('refuses an upload attached already with 409', async () => {
    const draft = await draftWithItems();
    const deed = upload('psc');
    api.documents.givenUploads(deed);
    const body = { sectionKey: STATEMENT, itemId: ASSET_ID, uploadId: deed.id };
    expect((await link(draft.id, body)).statusCode).toBe(201);

    const again = await link(draft.id, { ...body, itemId: incomeItem().id });

    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ type: 'upload-already-linked' });
    expect(await attachmentRows(draft.id)).toHaveLength(1);
    // Only the link that was stored is marked in documents.
    expect(api.documents.linked).toEqual([`psc ${deed.id}`]);
  });

  it('takes the link back and answers 503 when documents cannot mark it', async () => {
    const draft = await draftWithItems();
    const deed = upload('psc');
    api.documents.givenUploads(deed);
    api.documents.markLinkedUnavailable = true;

    const response = await link(draft.id, {
      sectionKey: STATEMENT,
      itemId: ASSET_ID,
      uploadId: deed.id,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'documents-unavailable' });
    expect(await attachmentRows(draft.id)).toEqual([]);
    const section = await statement(draft.id);
    // Stored at 3, taken back at 4.
    expect(section.draftVersion).toBe(4);
    expect(itemOf(section, 'assets', ASSET_ID).attachments).toEqual([]);
    expect(
      (await events('declaration.attachment-unlinked.v1')).map((event) => event.envelope),
    ).toEqual([expect.objectContaining({ data: { declarationId: draft.id, uploadId: deed.id } })]);

    api.documents.markLinkedUnavailable = false;
    const again = await link(draft.id, {
      sectionKey: STATEMENT,
      itemId: ASSET_ID,
      uploadId: deed.id,
    });
    expect(again.statusCode).toBe(201);
    expect(api.documents.linked).toEqual([`psc ${deed.id}`]);
  });

  it('answers 404 for an item the statement does not have, or a section without items', async () => {
    const draft = await draftWithItems();
    const deed = upload('psc');
    api.documents.givenUploads(deed);

    const noItem = await link(draft.id, {
      sectionKey: STATEMENT,
      itemId: randomUUID(),
      uploadId: deed.id,
    });
    const household = await link(draft.id, {
      sectionKey: 'household',
      itemId: ASSET_ID,
      uploadId: deed.id,
    });

    expect(noItem.statusCode).toBe(404);
    expect(household.statusCode).toBe(404);
    expect(api.documents.linked).toEqual([]);
  });

  it('answers 404 to anyone but the declarant, and 400 to a malformed body', async () => {
    const draft = await draftWithItems();
    const deed = upload('psc');
    api.documents.givenUploads(deed);
    const body = { sectionKey: STATEMENT, itemId: ASSET_ID, uploadId: deed.id };

    expect((await link(draft.id, body, declarant(OTIENO))).statusCode).toBe(404);
    expect((await link(draft.id, body, { tenant: 'psc', roles: ['reviewer'] })).statusCode).toBe(
      404,
    );
    expect((await link(draft.id, { ...body, uploadId: 'not-a-uuid' })).statusCode).toBe(400);
    expect(await attachmentRows(draft.id)).toEqual([]);
  });

  it('answers 503 when documents does not answer', async () => {
    const draft = await draftWithItems();
    api.documents.unavailable = true;

    const response = await link(draft.id, {
      sectionKey: STATEMENT,
      itemId: ASSET_ID,
      uploadId: randomUUID(),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'documents-unavailable' });
  });

  it('keeps references through section saves: a client cannot add, change or drop one', async () => {
    const draft = await draftWithItems();
    const deed = upload('psc', { fileName: 'logbook.jpg' });
    api.documents.givenUploads(deed);
    const linked = (
      await link(draft.id, { sectionKey: STATEMENT, itemId: ASSET_ID, uploadId: deed.id })
    ).json<DeclarationAttachment>();
    const forged = { uploadId: randomUUID(), fileName: 'forged.pdf', sha256: 'a'.repeat(64) };

    const saved = await saveStatement(
      draft.id,
      statementBody({
        income: [{ ...incomeItem(), attachments: [forged] }],
        assets: [{ ...assetItem(), description: 'Toyota Prado TX', attachments: [] }],
      }),
      '"3"',
    );

    expect(saved.statusCode).toBe(200);
    const section = await statement(draft.id);
    expect(itemOf(section, 'assets', ASSET_ID)).toMatchObject({
      description: 'Toyota Prado TX',
      attachments: [
        {
          attachmentId: linked.id,
          uploadId: deed.id,
          fileName: 'logbook.jpg',
          sha256: deed.sha256,
        },
      ],
    });
    expect(itemOf(section, 'income', incomeItem().id).attachments).toEqual([]);
  });

  it('unlinks the attachments of an item a save removes, with an event each', async () => {
    const draft = await draftWithItems();
    const deed = upload('psc');
    const payslip = upload('psc');
    api.documents.givenUploads(deed, payslip);
    await link(draft.id, { sectionKey: STATEMENT, itemId: ASSET_ID, uploadId: deed.id });
    const kept = (
      await link(draft.id, { sectionKey: STATEMENT, itemId: incomeItem().id, uploadId: payslip.id })
    ).json<DeclarationAttachment>();

    const saved = await saveStatement(
      draft.id,
      statementBody({ assetsNil: true, assets: [] }),
      '"4"',
    );

    expect(saved.statusCode).toBe(200);
    expect((await attachmentRows(draft.id)).map((row) => row.uploadId)).toEqual([payslip.id]);
    const unlinked = await events('declaration.attachment-unlinked.v1');
    expect(unlinked.map((event) => event.envelope)).toEqual([
      expect.objectContaining({
        subject: draft.id,
        tenant: 'psc',
        data: { declarationId: draft.id, uploadId: deed.id },
      }),
    ]);
    expect(itemOf(await statement(draft.id), 'income', incomeItem().id).attachments).toEqual([
      {
        attachmentId: kept.id,
        uploadId: payslip.id,
        fileName: payslip.fileName,
        sha256: payslip.sha256,
      },
    ]);
  });

  it('keeps the attachments when a save keeps the item', async () => {
    const draft = await draftWithItems();
    const deed = upload('psc');
    api.documents.givenUploads(deed);
    await link(draft.id, { sectionKey: STATEMENT, itemId: ASSET_ID, uploadId: deed.id });

    const saved = await saveStatement(draft.id, statementBody(), '"3"');

    expect(saved.statusCode).toBe(200);
    expect(await attachmentRows(draft.id)).toHaveLength(1);
    expect(await events('declaration.attachment-unlinked.v1')).toEqual([]);
  });
});

describe('ciphertext opacity for attachments (S13, ADR-006)', () => {
  it('keeps the file name out of every clear column: only the encrypted statement holds it', async () => {
    const draft = await draftWithItems();
    const deed = upload('psc', { fileName: 'title-deed-kisumu.pdf' });
    api.documents.givenUploads(deed);
    const linked = await link(draft.id, {
      sectionKey: STATEMENT,
      itemId: ASSET_ID,
      uploadId: deed.id,
    });
    expect(linked.statusCode).toBe(201);

    const { rows: attachments } = await api.asPerson(ACHIENG, (tx) =>
      tx.execute(sql`select * from declaration_attachments where declaration_id = ${draft.id}`),
    );
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ sha256: deed.sha256 });
    expect(JSON.stringify(attachments)).not.toContain('title-deed');

    const { rows: sections } = await api.asPerson(ACHIENG, (tx) =>
      tx.execute(
        sql`select section_key, metadata::text as metadata, encode(ciphertext, 'escape') as escaped
              from declaration_sections where declaration_id = ${draft.id}`,
      ),
    );
    expect(JSON.stringify(sections)).not.toContain('title-deed');
    expect(itemOf(await statement(draft.id), 'assets', ASSET_ID).attachments).toEqual([
      {
        attachmentId: linked.json<DeclarationAttachment>().id,
        uploadId: deed.id,
        fileName: 'title-deed-kisumu.pdf',
        sha256: deed.sha256,
      },
    ]);
  });
});

describe('unlinking an attachment (S10)', () => {
  it('removes the row and the reference, bumps the version and records the event', async () => {
    const draft = await draftWithItems();
    const deed = upload('psc');
    api.documents.givenUploads(deed);
    const linked = (
      await link(draft.id, { sectionKey: STATEMENT, itemId: ASSET_ID, uploadId: deed.id })
    ).json<DeclarationAttachment>();

    const response = await unlink(draft.id, linked.id);

    expect(response.statusCode).toBe(204);
    expect(response.headers.etag).toBe('"4"');
    expect(await attachmentRows(draft.id)).toEqual([]);
    const section = await statement(draft.id);
    expect(section.draftVersion).toBe(4);
    expect(itemOf(section, 'assets', ASSET_ID).attachments).toEqual([]);
    const unlinked = await events('declaration.attachment-unlinked.v1');
    expect(unlinked.map((event) => event.envelope)).toEqual([
      expect.objectContaining({
        subject: draft.id,
        tenant: 'psc',
        data: { declarationId: draft.id, uploadId: deed.id },
      }),
    ]);

    expect((await unlink(draft.id, linked.id)).statusCode).toBe(404);
  });

  it('answers 404 to anyone but the declarant and keeps the attachment', async () => {
    const draft = await draftWithItems();
    const deed = upload('psc');
    api.documents.givenUploads(deed);
    const linked = (
      await link(draft.id, { sectionKey: STATEMENT, itemId: ASSET_ID, uploadId: deed.id })
    ).json<DeclarationAttachment>();

    expect((await unlink(draft.id, linked.id, declarant(OTIENO))).statusCode).toBe(404);
    expect((await unlink(draft.id, randomUUID())).statusCode).toBe(404);
    expect(await attachmentRows(draft.id)).toHaveLength(1);
  });
});
