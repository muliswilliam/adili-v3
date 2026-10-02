import { randomUUID } from 'node:crypto';

import { parse } from '@adili/numbering';
import { TEMPORAL_CLIENT } from '@adili/temporal';
import type { Client } from '@temporalio/client';
import { asc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CaseDetail } from '../../src/cases/representation.js';
import { clarificationWorkflowId } from '../../src/clarifications/contract.js';
import type {
  ClarificationView,
  DeclarantClarificationView,
} from '../../src/clarifications/representation.js';
import { clarifications, outbox, reviewCases, reviewTimeline } from '../../src/db/schema.js';
import { asset, declaration, SPOUSE, statement } from '../fixtures/declarations.js';
import { givenAssignedCase } from '../support/cases.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { submittedVersion } from '../support/fake-declarations.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';

/**
 * S12 at the HTTP seam, with the declarant's reads and the letter payload: the assignee composes
 * and issues a clarification; issuing allocates the CLR reference, sets the due date, moves the
 * case and starts ClarificationWorkflow on Temporal, which requests the letter from the fake
 * documents service (which pulls the payload by clarification id) and notifies the declarant by
 * person through the fake notifications service.
 */
describe('clarifications: drafts, issue, letter payload, declarant reads', () => {
  let api: ReviewApi;

  const reviewerA: Caller = { sub: 'reviewer-a', tenant: 'psc', roles: ['reviewer'] };
  const reviewerB: Caller = { sub: 'reviewer-b', tenant: 'psc', roles: ['reviewer'] };
  const supervisor: Caller = { sub: 'supervisor-s', tenant: 'psc', roles: ['supervisor'] };
  const tscReviewer: Caller = { sub: 'reviewer-t', tenant: 'tsc', roles: ['reviewer'] };
  const documentsService: Caller = {
    sub: 'service-account-documents',
    scopes: ['review:internal'],
  };

  const plot = asset({ description: 'Plot KSM/123' });
  const spouseCar = asset({ type: 'vehicle', description: 'Toyota KDA 123A' });
  const version = submittedVersion({
    tenant: 'psc',
    submittedAt: '2027-12-10T09:00:00.000Z',
    declarantName: 'James Otieno',
    reference: 'DCB-PSC-2027-0000042-7',
    document: declaration([
      statement('officer', { assets: [plot] }),
      statement(SPOUSE, { assets: [spouseCar] }),
    ]),
  });
  const declarant: Caller = {
    sub: 'declarant-james',
    roles: ['declarant'],
    personId: version.personId,
  };

  const twoItems = {
    items: [
      {
        sectionKey: 'statement:officer',
        personKey: 'officer',
        itemId: plot.id,
        requirement: 'explain-discrepancy',
        text: 'Explain the increase in the value of the plot since your last declaration.',
      },
      {
        sectionKey: `statement:${SPOUSE}`,
        personKey: SPOUSE,
        itemId: spouseCar.id,
        requirement: 'provide-omitted',
        text: 'Provide the date of acquisition of the vehicle.',
      },
    ],
  };

  beforeAll(async () => {
    api = await startReviewApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    api.directory.givenCommission('psc');
    api.directory.givenCommission('tsc');
    api.declarations.given(version);
    api.clock.set('2027-12-20T08:00:00.000Z');
  });

  async function draft(caseId: string, body: unknown = twoItems, caller = reviewerA) {
    return api.send('POST', `/v1/review/cases/${caseId}/clarifications`, caller, body);
  }

  async function issue(clarificationId: string, caller = reviewerA) {
    return api.send(
      'POST',
      `/v1/review/clarifications/${clarificationId}/issue`,
      caller,
      undefined,
      {
        'idempotency-key': randomUUID(),
      },
    );
  }

  it('S12: the assignee drafts a clarification with two items', async () => {
    const caseId = await givenAssignedCase(api, version);

    const response = await draft(caseId);

    expect(response.statusCode, response.body).toBe(201);
    const body = response.json<ClarificationView>();
    expect(
      contractErrors(okResponse('/v1/review/cases/{caseId}/clarifications', 'post', 201), body),
    ).toEqual([]);
    expect(body).toMatchObject({
      caseId,
      reference: null,
      status: 'draft',
      issuedAt: null,
      dueAt: null,
      letter: null,
      response: null,
      items: twoItems.items,
    });
  });

  it('S12: the assignee updates a draft; an issued one is 409 not-a-draft', async () => {
    const caseId = await givenAssignedCase(api, version);
    const { id } = (await draft(caseId, { items: [] })).json<ClarificationView>();

    const updated = await api.send('PUT', `/v1/review/clarifications/${id}`, reviewerA, twoItems);
    expect(updated.statusCode, updated.body).toBe(200);
    expect(
      contractErrors(
        okResponse('/v1/review/clarifications/{clarificationId}', 'put'),
        updated.json(),
      ),
    ).toEqual([]);
    expect(updated.json<ClarificationView>().items).toEqual(twoItems.items);

    expect((await issue(id)).statusCode).toBe(200);
    const again = await api.send('PUT', `/v1/review/clarifications/${id}`, reviewerA, twoItems);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ type: 'not-a-draft', code: 'not-a-draft' });
    expect((await issue(id)).json()).toMatchObject({ code: 'not-a-draft' });
  });

  it('S12: issuing allocates CLR-PSC-2027-0000001, sets due +30 days, moves the case, requests the letter, notifies by person and starts the workflow', async () => {
    const caseId = await givenAssignedCase(api, version);
    const { id } = (await draft(caseId)).json<ClarificationView>();

    const response = await issue(id);

    expect(response.statusCode, response.body).toBe(200);
    const issued = response.json<ClarificationView>();
    expect(
      contractErrors(
        okResponse('/v1/review/clarifications/{clarificationId}/issue', 'post'),
        issued,
      ),
    ).toEqual([]);
    expect(issued.reference).toMatch(/^CLR-PSC-2027-0000001-[0-9A-Z]$/);
    expect(parse(issued.reference ?? '')).toMatchObject({
      scheme: 'CLR',
      issuer: 'PSC',
      period: 2027,
      sequence: 1,
    });
    expect(issued).toMatchObject({
      status: 'issued',
      issuedAt: '2027-12-20T08:00:00.000Z',
      dueAt: '2028-01-19T08:00:00.000Z',
    });

    // The case awaits the declarant, with the timeline entries and events in the same transaction.
    const [reviewCase] = await api.asPlatform((tx) =>
      tx.select().from(reviewCases).where(eq(reviewCases.id, caseId)),
    );
    expect(reviewCase).toMatchObject({ status: 'awaiting-clarification', openClarifications: 1 });
    const timeline = await api.asPlatform((tx) =>
      tx
        .select()
        .from(reviewTimeline)
        .where(eq(reviewTimeline.caseId, caseId))
        .orderBy(asc(reviewTimeline.at), asc(reviewTimeline.id)),
    );
    expect(timeline.map((entry) => [entry.kind, entry.ref, entry.actor])).toEqual([
      ['case-created', version.versionId, 'system:review'],
      ['clarification-issued', id, 'reviewer-a'],
      ['status-changed', null, 'reviewer-a'],
    ]);
    const events = await api.asPlatform((tx) => tx.select().from(outbox));
    const byType = (type: string) => events.filter((event) => event.envelope.type === type);
    expect(byType('clarification.issued.v1').map((event) => event.envelope)).toMatchObject([
      { subject: id, tenant: 'psc', data: { clarificationId: id, caseId } },
    ]);
    expect(byType('review.case.status-changed.v1').map((event) => event.envelope)).toMatchObject([
      {
        subject: caseId,
        tenant: 'psc',
        data: { caseId, from: 'assigned', to: 'awaiting-clarification' },
      },
    ]);
    // S21: identifiers and states only.
    for (const event of [
      ...byType('clarification.issued.v1'),
      ...byType('review.case.status-changed.v1'),
    ]) {
      const text = JSON.stringify(event.envelope.data);
      expect(text).not.toMatch(/Otieno|Plot|Toyota|CLR-|Explain/);
    }

    // ClarificationWorkflow: the letter first, pulled by clarification id, then email and SMS.
    const letter = await vi.waitFor(
      () => {
        expect(api.documents.issued).toHaveLength(1);
        return api.documents.issued[0];
      },
      { timeout: 45_000, interval: 250 },
    );
    expect(letter?.request).toEqual({
      type: 'clarification-letter',
      templateVersion: 1,
      subjectRef: `clarification:${id}`,
      subjectPersonId: version.personId,
      payload: { clarificationId: id },
    });
    expect(letter?.tenant).toBe('psc');
    expect(letter?.pulled.status).toBe(200);
    expect(letter?.pulled.body).toMatchObject({ clarificationReference: issued.reference });

    await vi.waitFor(
      () => {
        expect(api.notifications.sent).toHaveLength(2);
      },
      { timeout: 45_000, interval: 250 },
    );
    const portalUrl = `http://localhost:3010/clarifications/${id}`;
    expect(api.notifications.sent).toEqual([
      expect.objectContaining({
        channel: 'email',
        personId: version.personId,
        template: 'clarification-issued-email',
        tenant: 'psc',
        params: {
          commissionName: 'Public Service Commission',
          reference: issued.reference,
          dueDate: '2028-01-19',
          portalUrl,
        },
      }),
      expect.objectContaining({
        channel: 'sms',
        personId: version.personId,
        template: 'clarification-issued-sms',
        tenant: 'psc',
        params: {
          commissionName: 'Public Service Commission',
          reference: issued.reference,
          dueDate: '2028-01-19',
          portalUrl,
        },
      }),
    ]);
    const keys = new Set(api.notifications.sent.map((message) => message.idempotencyKey));
    expect(keys.size).toBe(2);

    const temporal = api.app.get<Client>(TEMPORAL_CLIENT);
    const run = await temporal.workflow.getHandle(clarificationWorkflowId(id)).describe();
    expect(run.type).toBe('clarification');

    // The letter is on the clarification once documents answered.
    const read = await api.get(`/v1/review/clarifications/${id}`, supervisor);
    expect(read.statusCode).toBe(200);
    expect(read.json<ClarificationView>().letter).toEqual({
      documentId: letter?.document.id,
      verificationId: letter?.document.verificationId,
      status: 'issued',
    });
  });

  it('S12: the next clarification of the Commission that year takes the next number', async () => {
    const caseId = await givenAssignedCase(api, version);
    const first = (await draft(caseId)).json<ClarificationView>();
    const second = (await draft(caseId)).json<ClarificationView>();

    const one = (await issue(first.id)).json<ClarificationView>();
    const two = (await issue(second.id)).json<ClarificationView>();

    expect(parse(one.reference ?? '').sequence).toBe(1);
    expect(parse(two.reference ?? '').sequence).toBe(2);
  });

  it('S12: a non-assignee gets 403; staff of another Commission and declarants get 404', async () => {
    const caseId = await givenAssignedCase(api, version);
    const { id } = (await draft(caseId)).json<ClarificationView>();

    expect((await draft(caseId, twoItems, reviewerB)).statusCode).toBe(403);
    expect((await draft(caseId, twoItems, supervisor)).statusCode).toBe(403);
    const byB = await issue(id, reviewerB);
    expect(byB.statusCode).toBe(403);
    expect(byB.json()).toMatchObject({ type: 'not-the-assignee' });

    expect((await draft(caseId, twoItems, tscReviewer)).statusCode).toBe(404);
    expect((await issue(id, tscReviewer)).statusCode).toBe(404);
    expect((await api.get(`/v1/review/clarifications/${id}`, tscReviewer)).statusCode).toBe(404);
    expect((await issue(id, declarant)).statusCode).toBe(404);

    const [row] = await api.asPlatform((tx) =>
      tx.select().from(clarifications).where(eq(clarifications.id, id)),
    );
    expect(row?.status).toBe('draft');
  });

  it("S18: only the Commission's reviewers and supervisors reach its clarifications; everyone else gets 404", async () => {
    const caseId = await givenAssignedCase(api, version);
    const { id: draftId } = (await draft(caseId)).json<ClarificationView>();
    const { id: issuedId } = (await draft(caseId)).json<ClarificationView>();
    expect((await issue(issuedId)).statusCode).toBe(200);

    const outsiders: [string, Caller][] = [
      ['tsc reviewer', tscReviewer],
      ['declarant', declarant],
      ['helpdesk', { tenant: 'psc', roles: ['helpdesk'] }],
      ['commission-admin', { tenant: 'psc', roles: ['commission-admin'] }],
      ['reporting-officer', { tenant: 'psc', roles: ['reporting-officer'] }],
      ['platform-admin', { tenant: 'platform', roles: ['platform-admin'] }],
      ['eacc-analyst', { tenant: 'eacc', roles: ['eacc-analyst'] }],
    ];
    const clarification = (id: string, action = '') =>
      `/v1/review/clarifications/${id}${action ? `/${action}` : ''}`;
    for (const [who, caller] of outsiders) {
      const calls: [string, ReturnType<ReviewApi['get']>][] = [
        ['get', api.get(clarification(issuedId), caller)],
        ['draft', draft(caseId, twoItems, caller)],
        ['update', api.send('PUT', clarification(draftId), caller, twoItems)],
        ['issue', issue(draftId, caller)],
        ['resolve', api.send('POST', clarification(issuedId, 'resolve'), caller, { note: 'n' })],
        ['follow-up', api.send('POST', clarification(issuedId, 'follow-up'), caller)],
        [
          'withdraw',
          api.send('POST', clarification(issuedId, 'withdraw'), caller, { reason: 'r' }),
        ],
      ];
      for (const [operation, call] of calls) {
        expect((await call).statusCode, `${who} ${operation}`).toBe(404);
      }
    }

    const rows = await api.asPlatform((tx) =>
      tx
        .select({ id: clarifications.id, status: clarifications.status })
        .from(clarifications)
        .where(eq(clarifications.caseId, caseId)),
    );
    expect(Object.fromEntries(rows.map((row) => [row.id, row.status]))).toEqual({
      [draftId]: 'draft',
      [issuedId]: 'issued',
    });
  });

  it('S12: after the window end, issuing is 409 clarification-window-closed', async () => {
    const caseId = await givenAssignedCase(api, version);
    const { id } = (await draft(caseId)).json<ClarificationView>();
    // Received 2027-12-10 09:00Z; the six-month window ends 2028-06-10 09:00Z.
    api.clock.set('2028-06-10T09:00:01.000Z');

    const response = await issue(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      type: 'clarification-window-closed',
      code: 'clarification-window-closed',
      windowEndsAt: '2028-06-10T09:00:00.000Z',
    });
    const counters = await api.asPlatform((tx) => tx.execute('select * from numbering_counters'));
    expect(counters.rows).toEqual([]);
  });

  it('S12: with no items, issuing is 400', async () => {
    const caseId = await givenAssignedCase(api, version);
    const { id } = (await draft(caseId, { items: [] })).json<ClarificationView>();

    const response = await issue(id);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'clarification-has-no-items' });
  });

  it('S12: issuing needs an Idempotency-Key, and a retry with the same key replays the answer', async () => {
    const caseId = await givenAssignedCase(api, version);
    const { id } = (await draft(caseId)).json<ClarificationView>();
    const url = `/v1/review/clarifications/${id}/issue`;

    expect((await api.send('POST', url, reviewerA)).statusCode).toBe(400);
    const key = { 'idempotency-key': randomUUID() };
    const first = await api.send('POST', url, reviewerA, undefined, key);
    const retry = await api.send('POST', url, reviewerA, undefined, key);

    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json()).toEqual(first.json());
  });

  it("the letter payload serves only the template fields and the declarant's person id, to a documents service token acting for the Commission", async () => {
    const caseId = await givenAssignedCase(api, version);
    const { id } = (await draft(caseId)).json<ClarificationView>();
    const payloadUrl = `/internal/v1/review/clarifications/${id}/letter-payload`;
    const psc = { 'x-acting-tenant': 'psc' };

    // A draft has no letter.
    expect((await api.get(payloadUrl, documentsService, psc)).statusCode).toBe(404);
    api.declarations.reads.length = 0;
    const { reference } = (await issue(id)).json<ClarificationView>();
    // Issuing fixes the letter: its labels are read from the declaration as filed, for the case,
    // as the reviewer issuing it.
    expect(api.declarations.reads).toEqual([
      {
        declarationId: version.declarationId,
        version: 1,
        tenant: 'psc',
        actingSubject: 'reviewer-a',
        caseId,
      },
    ]);
    // ClarificationWorkflow's letter activity holds a row lock while it issues: let it finish
    // before the reads below and the next reset.
    await vi.waitFor(
      () => {
        expect(api.documents.issued).toHaveLength(1);
      },
      { timeout: 45_000, interval: 250 },
    );
    api.declarations.reads.length = 0;

    const response = await api.get(payloadUrl, documentsService, psc);

    expect(response.statusCode, response.body).toBe(200);
    const payload = response.json<Record<string, unknown>>();
    expect(
      contractErrors(
        okResponse('/internal/v1/review/clarifications/{clarificationId}/letter-payload', 'get'),
        payload,
      ),
    ).toEqual([]);
    expect(payload).toEqual({
      declarantPersonId: version.personId,
      declarantName: 'James Otieno',
      commission: { name: 'Public Service Commission', issuerCode: 'PSC' },
      declarationReference: 'DCB-PSC-2027-0000042-7',
      clarificationReference: reference,
      items: [
        {
          label: 'Assets · Plot KSM/123 · James Otieno',
          requirementLabel: 'Explain the discrepancy or inconsistency',
          text: twoItems.items[0]?.text,
        },
        {
          label: 'Assets · Toyota KDA 123A · Grace Otieno',
          requirementLabel: 'Provide the omitted information',
          text: twoItems.items[1]?.text,
        },
      ],
      issuedAt: '2027-12-20T08:00:00.000Z',
      dueAt: '2028-01-19T08:00:00.000Z',
      portalUrl: `http://localhost:3010/clarifications/${id}`,
    });
    // Nothing beyond the template and who the letter is for: no other ids (the portal link names
    // the clarification, nothing else), amounts or other content.
    const printed = { ...payload, declarantPersonId: undefined };
    const text = JSON.stringify(printed);
    for (const leak of [caseId, version.personId, version.declarationId, plot.id, '1000000000']) {
      expect(text).not.toContain(leak);
    }
    // Rendering calls no other service (ADR-013 §7.3): the letter was fixed when it was issued.
    expect(api.declarations.reads).toEqual([]);

    // Another Commission, a user token, or no acting Commission: refused.
    expect(
      (await api.get(payloadUrl, documentsService, { 'x-acting-tenant': 'tsc' })).statusCode,
    ).toBe(404);
    expect((await api.get(payloadUrl, reviewerA, psc)).statusCode).toBe(403);
    expect((await api.get(payloadUrl, documentsService)).statusCode).toBe(400);

    // Declarations unreachable: the issued letter is served all the same.
    api.declarations.failReads(1);
    expect((await api.get(payloadUrl, documentsService, psc)).statusCode).toBe(200);
  });

  it("an issued clarification's items carry the labels its letter names; a draft's carry none", async () => {
    const caseId = await givenAssignedCase(api, version);
    const { id } = (await draft(caseId)).json<ClarificationView>();
    const itemsOf = async () => {
      const read = await api.get(`/v1/review/clarifications/${id}`, reviewerA);
      const detail = await api.get(`/v1/review/cases/${caseId}`, reviewerA);
      expect(
        contractErrors(
          okResponse('/v1/review/clarifications/{clarificationId}', 'get'),
          read.json(),
        ),
      ).toEqual([]);
      const listed = detail.json<CaseDetail>().clarifications.find((each) => each.id === id);
      return { read: read.json<ClarificationView>().items, listed: listed?.items };
    };

    const drafted = await itemsOf();
    expect(drafted.read.map((item) => item.label)).toEqual([undefined, undefined]);
    expect(drafted.listed).toEqual(drafted.read);

    expect((await issue(id)).statusCode).toBe(200);
    await vi.waitFor(
      () => {
        expect(api.documents.issued).toHaveLength(1);
      },
      { timeout: 45_000, interval: 250 },
    );

    const issued = await itemsOf();
    expect(issued.read).toEqual([
      { ...twoItems.items[0], label: 'Assets · Plot KSM/123 · James Otieno' },
      { ...twoItems.items[1], label: 'Assets · Toyota KDA 123A · Grace Otieno' },
    ]);
    expect(issued.listed).toEqual(issued.read);
  });

  it('issuing while declarations is unreachable is a 502 and issues nothing', async () => {
    const caseId = await givenAssignedCase(api, version);
    const { id } = (await draft(caseId)).json<ClarificationView>();
    api.declarations.failReads(1);

    const refused = await issue(id);

    expect(refused.statusCode).toBe(502);
    expect(refused.json()).toMatchObject({
      type: 'declarations-unavailable',
      title: 'Upstream service unavailable',
      status: 502,
    });
    const still = await api.get(`/v1/review/clarifications/${id}`, reviewerA);
    expect(still.json<ClarificationView>()).toMatchObject({ status: 'draft', reference: null });
    expect((await issue(id)).statusCode).toBe(200);
  });

  it("declarant: lists and reads their issued clarifications with the letter link, never drafts or other people's", async () => {
    const caseId = await givenAssignedCase(api, version);
    const hidden = (await draft(caseId)).json<ClarificationView>();
    const { id } = (await draft(caseId)).json<ClarificationView>();
    const issued = (await issue(id)).json<ClarificationView>();
    await vi.waitFor(
      () => {
        expect(api.documents.issued).toHaveLength(1);
      },
      { timeout: 45_000, interval: 250 },
    );
    const documentId = api.documents.issued[0]?.document.id;
    await vi.waitFor(
      async () => {
        const [row] = await api.asPlatform((tx) =>
          tx.select().from(clarifications).where(eq(clarifications.id, id)),
        );
        expect(row?.letterDocumentId).toBe(documentId);
      },
      { timeout: 15_000, interval: 250 },
    );

    const list = await api.get('/v1/me/clarifications', declarant);

    expect(list.statusCode, list.body).toBe(200);
    expect(contractErrors(okResponse('/v1/me/clarifications', 'get'), list.json())).toEqual([]);
    const expected = {
      id,
      caseId,
      reference: issued.reference,
      status: 'issued',
      items: twoItems.items,
      dueAt: '2028-01-19T08:00:00.000Z',
      commission: { slug: 'psc', name: 'Public Service Commission' },
      declarationReference: 'DCB-PSC-2027-0000042-7',
      letterDownloadUrl: `http://localhost:3010/api/documents/${String(documentId)}/download`,
    };
    expect(list.json<DeclarantClarificationView[]>()).toMatchObject([expected]);

    const one = await api.get(`/v1/me/clarifications/${id}`, declarant);
    expect(one.statusCode).toBe(200);
    expect(
      contractErrors(okResponse('/v1/me/clarifications/{clarificationId}', 'get'), one.json()),
    ).toEqual([]);
    expect(one.json()).toMatchObject(expected);

    expect((await api.get(`/v1/me/clarifications/${hidden.id}`, declarant)).statusCode).toBe(404);
    const someoneElse: Caller = {
      sub: 'declarant-x',
      roles: ['declarant'],
      personId: randomUUID(),
    };
    expect((await api.get(`/v1/me/clarifications/${id}`, someoneElse)).statusCode).toBe(404);
    expect((await api.get('/v1/me/clarifications', someoneElse)).json()).toEqual([]);
    // Staff tokens carry no person id.
    expect((await api.get('/v1/me/clarifications', reviewerA)).statusCode).toBe(404);
  });
});
