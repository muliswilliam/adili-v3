import { randomUUID } from 'node:crypto';

import type { EventEnvelope } from '@adili/events';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { commissionRefs, filingObligations, outbox, rosterSnapshots } from '../../src/db/schema.js';
import type {
  Declaration,
  DeclarationAttachment,
  SectionEnvelope,
} from '../../src/drafts/representation.js';
import type { SuggestionSet } from '../../src/suggestions/representation.js';
import { contractErrors } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { logbookReading } from '../support/fake-ai-gateway.js';
import { rosterRecord } from '../support/fake-directory.js';
import { upload } from '../support/fake-documents.js';
import { assetItem, liabilityItem } from '../fixtures/sections.js';

/**
 * Spec 05b S6 over HTTP: "Read into the form" on a clean attachment. The declarations service
 * asks documents for a short-lived link, submits an `extract-document` job to the ai-gateway
 * (faked) for the item the document is on, and records a `document` set; the gateway's
 * `ai.job.*` event (delivered to the consumer as the transport would) turns it into one
 * suggestion with fields, confidences and pages, or `not-enabled` and `failed`. Accepting it
 * goes through the section save like any suggestion.
 */

const ACHIENG = randomUUID();
const OTIENO = randomUUID();
const declarant = (personId: string): Caller => ({ personId, sub: personId, roles: ['declarant'] });
const achieng = declarant(ACHIENG);
const reviewer: Caller = { tenant: 'psc', roles: ['reviewer'] };
const STATEMENT = 'statement:officer';
const CAR = assetItem();
const LOAN = liabilityItem();

const EXTRACT_RESPONSE =
  '/paths/~1v1~1declarations~1{declarationId}~1attachments~1{attachmentId}~1extract/post/responses/202/content/application~1json/schema';

let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  await api.asPlatform((tx) =>
    tx
      .insert(commissionRefs)
      .values({ slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' }),
  );
});

/** Achieng's draft with her car and car loan, the car's logbook attached (a photo). */
async function draftWithLogbook(
  personId = ACHIENG,
  contentType = 'image/jpeg',
): Promise<{ draft: Declaration; attachment: DeclarationAttachment; uploadId: string }> {
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
  const caller = declarant(personId);
  const started = await api.request('POST', `/v1/obligations/${obligationId}/declaration`, caller);
  expect(started.statusCode).toBe(201);
  const draft = started.json<Declaration>();
  const saved = await api.request(
    'PUT',
    `/v1/declarations/${draft.id}/sections/${STATEMENT}`,
    caller,
    {
      headers: { 'if-match': '"1"' },
      body: {
        incomeNil: true,
        income: [],
        assetsNil: false,
        assets: [CAR],
        liabilitiesNil: false,
        liabilities: [LOAN],
      },
    },
  );
  expect(saved.statusCode).toBe(200);
  const logbook = upload('psc', personId, { fileName: 'logbook.jpg', contentType });
  api.documents.givenUploads(logbook);
  const linked = await api.request('POST', `/v1/declarations/${draft.id}/attachments`, caller, {
    body: { sectionKey: STATEMENT, itemId: CAR.id, uploadId: logbook.id },
  });
  expect(linked.statusCode).toBe(201);
  return { draft, attachment: linked.json<DeclarationAttachment>(), uploadId: logbook.id };
}

function extract(
  declarationId: string,
  attachmentId: string,
  body: Record<string, unknown> = { documentKindHint: 'logbook' },
  { caller = achieng, key = randomUUID() }: { caller?: Caller; key?: string } = {},
) {
  return api.request(
    'POST',
    `/v1/declarations/${declarationId}/attachments/${attachmentId}/extract`,
    caller,
    { headers: { 'idempotency-key': key }, body },
  );
}

async function documentSets(declarationId: string): Promise<SuggestionSet[]> {
  const response = await api.request(
    'GET',
    `/v1/declarations/${declarationId}/suggestions?sectionKey=${encodeURIComponent(STATEMENT)}`,
    achieng,
  );
  expect(response.statusCode).toBe(200);
  return response.json<SuggestionSet[]>().filter((set) => set.source === 'document');
}

/** The gateway's announcement that a job ended, as the transport delivers it. */
function jobEvent(
  type: 'ai.job.completed.v1' | 'ai.job.failed.v1' | 'ai.job.blocked.v1',
  job: { id: string; subjectRef: string },
  { task = 'extract-document', reason = null }: { task?: string; reason?: string | null } = {},
): EventEnvelope {
  return {
    specversion: '1.0',
    id: uuidv7(),
    source: 'adili/ai-gateway',
    type,
    time: new Date().toISOString(),
    datacontenttype: 'application/json',
    tenant: 'psc',
    subject: job.id,
    data: { jobId: job.id, task, tenant: 'psc', subjectRef: job.subjectRef, reason },
  };
}

async function eventsOf(type: string) {
  const rows = await api.db
    .select({ envelope: outbox.envelope })
    .from(outbox)
    .where(eq(outbox.eventType, type));
  return rows.map((row) => row.envelope);
}

async function statement(declarationId: string): Promise<SectionEnvelope> {
  const response = await api.request(
    'GET',
    `/v1/declarations/${declarationId}/sections/${STATEMENT}`,
    achieng,
  );
  return response.json<SectionEnvelope>();
}

async function etagOf(declarationId: string): Promise<string> {
  const response = await api.request('GET', `/v1/declarations/${declarationId}`, achieng);
  return String(response.headers.etag);
}

describe('reading a document (S6)', () => {
  it('asks the gateway to read the attached logbook into the vehicle it is on', async () => {
    const { draft, attachment, uploadId } = await draftWithLogbook();

    const response = await extract(draft.id, attachment.id);

    expect(response.statusCode).toBe(202);
    const set = response.json<SuggestionSet>();
    expect(contractErrors(EXTRACT_RESPONSE, set)).toEqual([]);
    const job = api.ai.onlyJob();
    expect(set).toMatchObject({
      personKey: 'officer',
      source: 'document',
      status: 'pending',
      attachmentId: attachment.id,
      documentKind: 'logbook',
      aiJobId: job.id,
      reason: null,
      suggestions: [],
    });
    expect(api.documents.downloads).toEqual([`psc ${uploadId} ${ACHIENG}`]);
    expect(job.request).toEqual({
      tenant: 'psc',
      subjectRef: `declaration:${draft.id}`,
      input: {
        kind: 'extract-document',
        documentKindHint: 'logbook',
        target: { section: 'assets', itemType: 'vehicle' },
        attachment: {
          downloadUrl: expect.stringMatching(/^http:\/\/documents\.test\/objects\//) as string,
          contentType: 'image/jpeg',
          sha256: attachment.sha256,
        },
        language: 'en',
      },
    });
    expect(await eventsOf('declaration.extraction-requested.v1')).toEqual([
      expect.objectContaining({
        subject: draft.id,
        tenant: 'psc',
        data: {
          declarationId: draft.id,
          attachmentId: attachment.id,
          setId: set.id,
          aiJobId: job.id,
        },
      }),
    ]);
  });

  it('turns the finished job into one suggestion with fields, confidences and pages', async () => {
    const { draft, attachment } = await draftWithLogbook();
    const set = (await extract(draft.id, attachment.id)).json<SuggestionSet>();
    const job = api.ai.finish(api.ai.onlyJob().id, { output: logbookReading() });

    await api.extractionJobs.completed(jobEvent('ai.job.completed.v1', job));

    const [read] = await documentSets(draft.id);
    expect(read).toMatchObject({ id: set.id, status: 'ready', reason: null });
    expect(read?.readyAt).not.toBeNull();
    expect(read?.suggestions).toEqual([
      {
        id: expect.any(String) as string,
        setId: set.id,
        personKey: 'officer',
        sectionKey: STATEMENT,
        itemType: 'vehicle',
        fields: {
          'details.registration': 'KCB 782M',
          'details.makeModel': 'Toyota Premio',
          'value.kesCents': 95_000_000,
        },
        sourceRef: {
          attachmentId: attachment.id,
          documentKind: 'logbook',
          fields: [
            { name: 'details.registration', confidence: 0.97, page: 1 },
            { name: 'details.makeModel', confidence: 0.82, page: 1 },
            { name: 'value.kesCents', confidence: 0.41, page: null },
          ],
          warnings: ['Page 2 could not be read.'],
        },
        confidence: 0.41,
        matchItemId: CAR.id,
        status: 'new',
        acceptedItemId: null,
      },
    ]);
    expect(await eventsOf('declaration.suggestions-ready.v1')).toEqual([
      expect.objectContaining({
        data: { declarationId: draft.id, setId: set.id, source: 'document', count: 1 },
      }),
    ]);
  });

  it('records a reading whose event has not arrived when the declarant asks again', async () => {
    const { draft, attachment } = await draftWithLogbook();
    const first = (await extract(draft.id, attachment.id)).json<SuggestionSet>();
    api.ai.finish(api.ai.onlyJob().id, { output: logbookReading() });

    const again = await extract(draft.id, attachment.id);

    expect(again.statusCode).toBe(202);
    expect(again.json<SuggestionSet>()).toMatchObject({ id: first.id, status: 'ready' });
    expect(again.json<SuggestionSet>().suggestions).toHaveLength(1);
    expect(api.ai.requests).toHaveLength(1);
  });

  it('records a job the gateway answers finished at once (an equal request it has read)', async () => {
    const { draft, attachment } = await draftWithLogbook();
    await extract(draft.id, attachment.id);
    const job = api.ai.finish(api.ai.onlyJob().id, { output: logbookReading() });
    await api.extractionJobs.completed(jobEvent('ai.job.completed.v1', job));
    const [read] = await documentSets(draft.id);
    const suggestion = read?.suggestions[0];
    if (!suggestion) throw new Error('no suggestion');
    await api.request(
      'POST',
      `/v1/declarations/${draft.id}/suggestions/${suggestion.id}/dismiss`,
      achieng,
      { body: {} },
    );

    const again = await extract(draft.id, attachment.id);

    expect(again.json<SuggestionSet>()).toMatchObject({ status: 'ready', aiJobId: job.id });
    expect(again.json<SuggestionSet>().suggestions.map((each) => each.status)).toEqual(['new']);
  });

  it('applies the reading to the item, filling what it leaves empty, with the document as source', async () => {
    const { draft, attachment } = await draftWithLogbook();
    await extract(draft.id, attachment.id);
    const job = api.ai.finish(api.ai.onlyJob().id, { output: logbookReading() });
    await api.extractionJobs.completed(jobEvent('ai.job.completed.v1', job));
    const [read] = await documentSets(draft.id);
    const suggestion = read?.suggestions[0];
    if (!suggestion) throw new Error('no suggestion');

    const accepted = await api.request(
      'POST',
      `/v1/declarations/${draft.id}/suggestions/${suggestion.id}/accept`,
      achieng,
      {
        headers: { 'if-match': await etagOf(draft.id) },
        body: { fields: suggestion.fields, applyToItemId: CAR.id },
      },
    );

    expect(accepted.statusCode).toBe(200);
    const assets = (await statement(draft.id)).contents.assets as Record<string, unknown>[];
    expect(assets).toEqual([
      {
        ...CAR,
        details: { registration: 'KCB 782M', makeModel: 'Toyota Premio' },
        attachments: [expect.objectContaining({ attachmentId: attachment.id })],
        source: {
          kind: 'document',
          suggestionId: suggestion.id,
          aiJobId: job.id,
          at: expect.any(String) as string,
        },
      },
    ]);
  });

  it('adds the reading as a new item, with the edited amount', async () => {
    const { draft, attachment } = await draftWithLogbook();
    await extract(draft.id, attachment.id);
    const job = api.ai.finish(api.ai.onlyJob().id, { output: logbookReading() });
    await api.extractionJobs.completed(jobEvent('ai.job.completed.v1', job));
    const suggestion = (await documentSets(draft.id))[0]?.suggestions[0];
    if (!suggestion) throw new Error('no suggestion');

    const accepted = await api.request(
      'POST',
      `/v1/declarations/${draft.id}/suggestions/${suggestion.id}/accept`,
      achieng,
      {
        headers: { 'if-match': await etagOf(draft.id) },
        body: {
          fields: { ...suggestion.fields, 'value.kesCents': 90_000_000 },
          applyToItemId: null,
        },
      },
    );

    expect(accepted.statusCode).toBe(200);
    const { itemId } = accepted.json<{ itemId: string }>();
    const assets = (await statement(draft.id)).contents.assets as Record<string, unknown>[];
    expect(assets.find((item) => item.id === itemId)).toMatchObject({
      type: 'vehicle',
      details: { registration: 'KCB 782M', makeModel: 'Toyota Premio' },
      value: { kesCents: 90_000_000 },
      source: { kind: 'document', aiJobId: job.id },
    });
  });

  it('reads a loan letter into the loan it is attached to, in liabilities', async () => {
    const { draft } = await draftWithLogbook();
    const letter = upload('psc', ACHIENG, { fileName: 'loan-letter.pdf' });
    api.documents.givenUploads(letter);
    const linked = await api.request('POST', `/v1/declarations/${draft.id}/attachments`, achieng, {
      body: { sectionKey: STATEMENT, itemId: LOAN.id, uploadId: letter.id },
    });

    await extract(draft.id, linked.json<DeclarationAttachment>().id, {
      documentKindHint: 'bank-letter',
      language: 'sw',
    });

    expect(api.ai.onlyJob().request.input).toMatchObject({
      documentKindHint: 'bank-letter',
      target: { section: 'liabilities', itemType: 'loan' },
      attachment: { contentType: 'application/pdf' },
      language: 'sw',
    });
  });
});

describe('when the Commission does not read documents, or the reading fails (S6)', () => {
  it('says not-enabled when the gateway blocks the job by policy', async () => {
    const { draft, attachment } = await draftWithLogbook();
    api.ai.blocked.add('psc');

    const response = await extract(draft.id, attachment.id);

    expect(response.statusCode).toBe(202);
    expect(response.json<SuggestionSet>()).toMatchObject({ status: 'not-enabled', reason: null });
    expect((await documentSets(draft.id)).map((set) => set.status)).toEqual(['not-enabled']);
  });

  it('records a failed job with its reason, and a retry reads the document again', async () => {
    const { draft, attachment } = await draftWithLogbook();
    await extract(draft.id, attachment.id);
    const job = api.ai.finish(api.ai.onlyJob().id, { reason: 'document-unavailable' });

    await api.extractionJobs.failed(
      jobEvent('ai.job.failed.v1', job, { reason: 'document-unavailable' }),
    );

    expect(await documentSets(draft.id)).toEqual([
      expect.objectContaining({
        status: 'failed',
        reason: 'document-unavailable',
        suggestions: [],
      }),
    ]);
    const retried = await extract(draft.id, attachment.id);
    expect(retried.statusCode).toBe(202);
    expect(retried.json<SuggestionSet>()).toMatchObject({ status: 'pending' });
    expect(api.ai.jobs.size).toBe(2);
  });

  it.each([
    ['validation', 'not-read'],
    ['refused', 'not-read'],
    ['document-unreadable', 'document-unreadable'],
    ['provider-unavailable', 'unavailable'],
    ['timeout', 'unavailable'],
  ] as const)('tells the declarant a %s failure as %s', async (jobReason, reason) => {
    const { draft, attachment } = await draftWithLogbook();
    await extract(draft.id, attachment.id);
    const job = api.ai.finish(api.ai.onlyJob().id, { reason: jobReason });

    await api.extractionJobs.failed(jobEvent('ai.job.failed.v1', job, { reason: jobReason }));

    expect((await documentSets(draft.id))[0]).toMatchObject({ status: 'failed', reason });
  });

  it('fails a file a reading does not take without asking the gateway', async () => {
    const { draft, attachment } = await draftWithLogbook(ACHIENG, 'image/heic');

    const response = await extract(draft.id, attachment.id);

    expect(response.statusCode).toBe(202);
    expect(response.json<SuggestionSet>()).toMatchObject({
      status: 'failed',
      reason: 'document-unreadable',
      aiJobId: null,
    });
    expect(api.ai.requests).toEqual([]);
    expect(await eventsOf('declaration.extraction-requested.v1')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ aiJobId: null }) as unknown }),
    ]);
  });

  it('answers 503 and records nothing when the gateway cannot take the request', async () => {
    const { draft, attachment } = await draftWithLogbook();
    api.ai.unavailable = true;

    const response = await extract(draft.id, attachment.id);

    expect(response.statusCode).toBe(503);
    expect(await documentSets(draft.id)).toEqual([]);
  });

  it('ignores the events of other tasks and of jobs it did not ask for', async () => {
    const { draft, attachment } = await draftWithLogbook();
    await extract(draft.id, attachment.id);
    const job = api.ai.finish(api.ai.onlyJob().id, { output: logbookReading() });

    await api.extractionJobs.completed(
      jobEvent('ai.job.completed.v1', job, { task: 'summarize-declaration' }),
    );
    await api.extractionJobs.completed(
      jobEvent('ai.job.completed.v1', { id: randomUUID(), subjectRef: `declaration:${draft.id}` }),
    );

    expect((await documentSets(draft.id)).map((set) => set.status)).toEqual(['pending']);
  });
});

describe('one reading per attachment and kind', () => {
  it('answers a repeated request with the reading already under way', async () => {
    const { draft, attachment } = await draftWithLogbook();
    const key = randomUUID();

    const first = (
      await extract(draft.id, attachment.id, undefined, { key })
    ).json<SuggestionSet>();
    const replayed = await extract(draft.id, attachment.id, undefined, { key });
    const again = await extract(draft.id, attachment.id);

    expect(replayed.json<SuggestionSet>().id).toBe(first.id);
    expect(again.json<SuggestionSet>().id).toBe(first.id);
    expect(api.ai.requests).toHaveLength(1);
    expect(await documentSets(draft.id)).toHaveLength(1);
  });

  it('reads it again as another kind, superseding the earlier reading not decided on', async () => {
    const { draft, attachment } = await draftWithLogbook();
    await extract(draft.id, attachment.id);
    const first = api.ai.finish(api.ai.onlyJob().id, { output: logbookReading() });
    await api.extractionJobs.completed(jobEvent('ai.job.completed.v1', first));

    await extract(draft.id, attachment.id, { documentKindHint: 'other' });
    const second = [...api.ai.jobs.values()].find((job) => job.id !== first.id);
    if (!second) throw new Error('no second job');
    api.ai.finish(second.id, { output: logbookReading({ detectedKind: 'other' }) });
    await api.extractionJobs.completed(jobEvent('ai.job.completed.v1', second));

    const sets = await documentSets(draft.id);
    expect(sets.map((set) => set.suggestions.map((each) => each.status))).toEqual([
      ['superseded'],
      ['new'],
    ]);
  });
});

describe('who may read (S9)', () => {
  it('refuses with 404 another declarant, a reviewer and an attachment not on the draft', async () => {
    const { draft, attachment } = await draftWithLogbook();

    expect(
      (await extract(draft.id, attachment.id, undefined, { caller: declarant(OTIENO) })).statusCode,
    ).toBe(404);
    expect(
      (await extract(draft.id, attachment.id, undefined, { caller: reviewer })).statusCode,
    ).toBe(404);
    expect((await extract(draft.id, randomUUID())).statusCode).toBe(404);
    expect(api.ai.requests).toEqual([]);
  });

  it('refuses with 409 an attachment documents no longer holds clean', async () => {
    const { draft, attachment, uploadId } = await draftWithLogbook();
    api.documents.givenUploads(upload('psc', ACHIENG, { id: uploadId, state: 'infected' }));

    const response = await extract(draft.id, attachment.id);

    expect(response.statusCode).toBe(409);
    expect(api.ai.requests).toEqual([]);
  });

  it('refuses with 400 an unknown kind or language', async () => {
    const { draft, attachment } = await draftWithLogbook();

    expect(
      (await extract(draft.id, attachment.id, { documentKindHint: 'passport' })).statusCode,
    ).toBe(400);
    expect(
      (
        await extract(draft.id, attachment.id, {
          documentKindHint: 'logbook',
          language: 'fr',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('answers 400 without an Idempotency-Key', async () => {
    const { draft, attachment } = await draftWithLogbook();

    const response = await api.request(
      'POST',
      `/v1/declarations/${draft.id}/attachments/${attachment.id}/extract`,
      achieng,
      { body: { documentKindHint: 'logbook' } },
    );

    expect(response.statusCode).toBe(400);
  });
});
