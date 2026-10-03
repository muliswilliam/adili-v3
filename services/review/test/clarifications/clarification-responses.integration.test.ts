import { randomUUID } from 'node:crypto';

import { TEMPORAL_CLIENT } from '@adili/temporal';
import type { Client } from '@temporalio/client';
import { asc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClarificationActivities } from '../../src/clarifications/activities.js';
import {
  type ClarificationResult,
  clarificationWorkflowId,
} from '../../src/clarifications/contract.js';
import type {
  ClarificationView,
  DeclarantClarificationView,
} from '../../src/clarifications/representation.js';
import {
  clarificationResponses,
  clarifications,
  outbox,
  reviewCases,
  reviewTimeline,
} from '../../src/db/schema.js';
import { asset, declaration, SPOUSE, statement } from '../fixtures/declarations.js';
import { givenAssignedCase } from '../support/cases.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { submittedVersion } from '../support/fake-declarations.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';
import { historyPayloads } from '../support/workflow-history.js';

/**
 * S13 (the activities behind the workflow's clock, against the database), S14 and S15 at the HTTP
 * seam: the declarant responds once with per-item text and attachments verified through the fake
 * documents service, late after the due date; the assignee resolves (case `clarified` then
 * `ready-for-determination`), raises a follow-up or withdraws (letter revoked as issued in
 * error). ClarificationWorkflow runs on Temporal through the service's worker; the issue time is
 * in 2027, so its timers never fire here and each signal ends it.
 */
describe('clarifications: responses, clock, resolve, follow-up, withdraw', () => {
  let api: ReviewApi;
  let temporal: Client;

  const reviewerA: Caller = { sub: 'reviewer-a', tenant: 'psc', roles: ['reviewer'] };
  const reviewerB: Caller = { sub: 'reviewer-b', tenant: 'psc', roles: ['reviewer'] };

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

  const receipt = randomUUID();
  const logbook = randomUUID();

  beforeAll(async () => {
    api = await startReviewApi();
    temporal = api.app.get<Client>(TEMPORAL_CLIENT);
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    api.directory.givenCommission('psc');
    api.directory.givenCommission('tsc');
    api.declarations.given(version);
    api.documents.givenUpload(receipt, {
      tenant: 'psc',
      purpose: 'clarification-attachment',
      fileName: 'valuation-report.pdf',
      sha256: 'a'.repeat(64),
    });
    api.documents.givenUpload(logbook, {
      tenant: 'psc',
      purpose: 'clarification-attachment',
      fileName: 'logbook.jpg',
      sha256: 'b'.repeat(64),
    });
    api.clock.set('2027-12-20T08:00:00.000Z');
  });

  /** A clarification of the case, drafted and issued by reviewer A. */
  async function issued(caseId: string, body: object = twoItems): Promise<ClarificationView> {
    const { id } = (
      await api.send('POST', `/v1/review/cases/${caseId}/clarifications`, reviewerA, body)
    ).json<ClarificationView>();
    const response = await issue(id);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<ClarificationView>();
  }

  function issue(id: string) {
    return api.send('POST', `/v1/review/clarifications/${id}/issue`, reviewerA, undefined, {
      'idempotency-key': randomUUID(),
    });
  }

  /** Waits until the workflow has kept the clarification's letter. */
  async function letterOf(id: string): Promise<string> {
    return vi.waitFor(
      async () => {
        const [row] = await api.asPlatform((tx) =>
          tx.select().from(clarifications).where(eq(clarifications.id, id)),
        );
        expect(row?.letterDocumentId).toBeTruthy();
        return row?.letterDocumentId ?? '';
      },
      { timeout: 45_000, interval: 250 },
    );
  }

  const answers = {
    items: [
      { index: 0, text: 'The plot was revalued by a registered valuer.', attachments: [receipt] },
      { index: 1, text: 'Acquired on 3 March 2026.', attachments: [logbook] },
    ],
  };

  function respond(id: string, body: unknown = answers, caller: Caller = declarant) {
    return api.send('POST', `/v1/me/clarifications/${id}/response`, caller, body, {
      'idempotency-key': randomUUID(),
    });
  }

  const resolve = (id: string, caller = reviewerA) =>
    api.send('POST', `/v1/review/clarifications/${id}/resolve`, caller, {
      note: 'The valuation report explains the increase.',
    });

  const withdraw = (id: string, caller = reviewerA) =>
    api.send('POST', `/v1/review/clarifications/${id}/withdraw`, caller, {
      reason: 'Sent to the wrong declarant file.',
    });

  const workflowResult = (id: string) =>
    temporal.workflow
      .getHandle(clarificationWorkflowId(id))
      .result() as Promise<ClarificationResult>;

  async function events(type: string) {
    const rows = await api.asPlatform((tx) => tx.select().from(outbox));
    return rows.filter((row) => row.envelope.type === type).map((row) => row.envelope);
  }

  async function row(id: string) {
    const [found] = await api.asPlatform((tx) =>
      tx.select().from(clarifications).where(eq(clarifications.id, id)),
    );
    return found;
  }

  async function caseRow(caseId: string) {
    const [found] = await api.asPlatform((tx) =>
      tx.select().from(reviewCases).where(eq(reviewCases.id, caseId)),
    );
    return found;
  }

  async function timeline(caseId: string) {
    const entries = await api.asPlatform((tx) =>
      tx
        .select()
        .from(reviewTimeline)
        .where(eq(reviewTimeline.caseId, caseId))
        .orderBy(asc(reviewTimeline.at), asc(reviewTimeline.id)),
    );
    return entries.map((entry) => [entry.kind, entry.summary]);
  }

  /** S21: identifiers and states only. */
  async function expectNoContentInEvents() {
    const rows = await api.asPlatform((tx) => tx.select().from(outbox));
    for (const event of rows) {
      expect(JSON.stringify(event.envelope.data)).not.toMatch(
        /Otieno|Plot|Toyota|CLR-|valuer|March|wrong declarant|valuation/,
      );
    }
  }

  describe('S14: the declarant responds', () => {
    it('lists the clarification with the letter link (owner rule), items and due date', async () => {
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);
      const documentId = await letterOf(clarification.id);

      const list = await api.get('/v1/me/clarifications', declarant);

      expect(list.statusCode).toBe(200);
      expect(list.json<DeclarantClarificationView[]>()).toMatchObject([
        {
          id: clarification.id,
          status: 'issued',
          items: twoItems.items,
          dueAt: '2028-01-19T08:00:00.000Z',
          letter: { documentId, status: 'issued' },
          letterDownloadUrl: `http://localhost:3010/api/documents/${documentId}/download`,
          response: null,
        },
      ]);
    });

    it('responds with per-item text and two clean attachments: responded, event, workflow signalled', async () => {
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);
      api.clock.set('2028-01-05T10:00:00.000Z');

      const response = await respond(clarification.id);

      expect(response.statusCode, response.body).toBe(201);
      const body = response.json<DeclarantClarificationView>();
      expect(
        contractErrors(
          okResponse('/v1/me/clarifications/{clarificationId}/response', 'post', 201),
          body,
        ),
      ).toEqual([]);
      expect(body).toMatchObject({
        status: 'responded',
        respondedAt: '2028-01-05T10:00:00.000Z',
        responseLate: false,
        response: {
          submittedAt: '2028-01-05T10:00:00.000Z',
          items: [
            {
              index: 0,
              text: answers.items[0]?.text,
              attachments: [
                { uploadId: receipt, fileName: 'valuation-report.pdf', sha256: 'a'.repeat(64) },
              ],
            },
            {
              index: 1,
              text: answers.items[1]?.text,
              attachments: [{ uploadId: logbook, fileName: 'logbook.jpg', sha256: 'b'.repeat(64) }],
            },
          ],
        },
      });
      // Each attachment was checked with documents for the Commission, read for the declarant
      // (M13, ADR-013 §8.6).
      const actingSubject = `person:${version.personId}`;
      expect(api.documents.downloads).toEqual([
        { uploadId: receipt, tenant: 'psc', actingSubject },
        { uploadId: logbook, tenant: 'psc', actingSubject },
      ]);

      expect(await events('clarification.responded.v1')).toMatchObject([
        {
          subject: clarification.id,
          tenant: 'psc',
          data: { clarificationId: clarification.id, caseId, late: false },
        },
      ]);
      expect((await timeline(caseId)).map(([kind]) => kind)).toContain('clarification-responded');
      // Responding leaves the case awaiting the reviewer's decision.
      expect(await caseRow(caseId)).toMatchObject({
        status: 'awaiting-clarification',
        openClarifications: 1,
      });
      expect(await workflowResult(clarification.id)).toEqual({ outcome: 'responded' });

      // The reviewer sees the response.
      const staffView = await api.get(`/v1/review/clarifications/${clarification.id}`, reviewerA);
      expect(staffView.json<ClarificationView>().response?.items).toHaveLength(2);
      await expectNoContentInEvents();
    });

    it("keeps the declarant's name, file number, items and answers out of the workflow history", async () => {
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);
      await letterOf(clarification.id);
      expect((await respond(clarification.id)).statusCode).toBe(201);
      expect(await workflowResult(clarification.id)).toEqual({ outcome: 'responded' });

      const history = await historyPayloads(temporal, clarificationWorkflowId(clarification.id));

      expect(history).toContain(clarification.id);
      for (const personal of [
        version.declarantName,
        version.personnelFileNumber,
        clarification.reference ?? 'CLR-',
        ...twoItems.items.map((item) => item.text),
        ...answers.items.map((item) => item.text),
      ]) {
        expect(history).not.toContain(personal);
      }
    });

    it('a second response is 409 already-responded; the first stands', async () => {
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);
      expect((await respond(clarification.id)).statusCode).toBe(201);

      const again = await respond(clarification.id, {
        items: [{ index: 0, text: 'Something else.', attachments: [] }],
      });

      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({ code: 'already-responded' });
      const responses = await api.asPlatform((tx) =>
        tx
          .select()
          .from(clarificationResponses)
          .where(eq(clarificationResponses.clarificationId, clarification.id)),
      );
      expect(responses).toHaveLength(1);
      expect(responses[0]?.items[0]?.text).toBe(answers.items[0]?.text);
      expect(await events('clarification.responded.v1')).toHaveLength(1);
    });

    it('after the due date the response is accepted and marked late', async () => {
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);
      // Due 2028-01-19 08:00Z.
      api.clock.set('2028-01-19T08:00:01.000Z');

      const response = await respond(clarification.id);

      expect(response.statusCode, response.body).toBe(201);
      expect(response.json()).toMatchObject({ status: 'responded', responseLate: true });
      expect(await events('clarification.responded.v1')).toMatchObject([
        { data: { clarificationId: clarification.id, caseId, late: true } },
      ]);
      expect((await timeline(caseId)).find(([kind]) => kind === 'clarification-responded')).toEqual(
        [
          'clarification-responded',
          `Clarification ${String(clarification.reference)} responded late`,
        ],
      );
    });

    it('an overdue clarification takes a late response', async () => {
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);
      await api.app.get(ClarificationActivities).markOverdue({
        tenant: 'psc',
        clarificationId: clarification.id,
      });
      api.clock.set('2028-02-01T08:00:00.000Z');

      const response = await respond(clarification.id);

      expect(response.statusCode, response.body).toBe(201);
      expect(response.json()).toMatchObject({ status: 'responded', responseLate: true });
    });

    it('refuses attachments that are not clean, not for a clarification or not the Commission’s, and bad answers; nothing changes', async () => {
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);
      const infected = randomUUID();
      const roster = randomUUID();
      const elsewhere = randomUUID();
      api.documents.givenUpload(infected, {
        tenant: 'psc',
        purpose: 'clarification-attachment',
        state: 'infected',
      });
      api.documents.givenUpload(roster, { tenant: 'psc', purpose: 'roster-import' });
      api.documents.givenUpload(elsewhere, { tenant: 'tsc', purpose: 'clarification-attachment' });
      const withAttachment = (uploadId: string) => ({
        items: [{ index: 0, text: 'See attached.', attachments: [uploadId] }],
      });

      const notClean = await respond(clarification.id, withAttachment(infected));
      expect(notClean.statusCode).toBe(409);
      expect(notClean.json()).toMatchObject({ code: 'attachment-not-clean', uploadId: infected });
      for (const uploadId of [roster, elsewhere, randomUUID()]) {
        const refused = await respond(clarification.id, withAttachment(uploadId));
        expect(refused.statusCode).toBe(409);
        expect(refused.json()).toMatchObject({ code: 'attachment-not-accepted', uploadId });
      }
      const noSuchItem = await respond(clarification.id, {
        items: [{ index: 2, text: 'An answer.', attachments: [] }],
      });
      expect(noSuchItem.statusCode).toBe(400);
      const twice = await respond(clarification.id, {
        items: [
          { index: 0, text: 'One.', attachments: [] },
          { index: 0, text: 'Two.', attachments: [] },
        ],
      });
      expect(twice.statusCode).toBe(400);
      expect((await respond(clarification.id, { items: [] })).statusCode).toBe(400);

      expect(await row(clarification.id)).toMatchObject({ status: 'issued', respondedAt: null });
      expect(await events('clarification.responded.v1')).toEqual([]);
    });

    it('another person, staff and a withdrawn clarification: 404 or 409 clarification-closed', async () => {
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);
      const someoneElse: Caller = {
        sub: 'declarant-x',
        roles: ['declarant'],
        personId: randomUUID(),
      };
      expect((await respond(clarification.id, answers, someoneElse)).statusCode).toBe(404);
      expect((await respond(clarification.id, answers, reviewerA)).statusCode).toBe(404);
      expect((await respond(randomUUID())).statusCode).toBe(404);

      await letterOf(clarification.id);
      expect((await withdraw(clarification.id)).statusCode).toBe(200);
      const closed = await respond(clarification.id);
      expect(closed.statusCode).toBe(409);
      expect(closed.json()).toMatchObject({ code: 'clarification-closed' });
    });
  });

  describe('S15: the assignee resolves, follows up or withdraws', () => {
    it('resolves with a note: resolved; the case clarified then ready for determination', async () => {
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);
      expect((await respond(clarification.id)).statusCode).toBe(201);
      api.clock.set('2028-01-10T09:00:00.000Z');

      const response = await resolve(clarification.id);

      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<ClarificationView>();
      expect(
        contractErrors(
          okResponse('/v1/review/clarifications/{clarificationId}/resolve', 'post'),
          body,
        ),
      ).toEqual([]);
      expect(body).toMatchObject({
        status: 'resolved',
        resolvedAt: '2028-01-10T09:00:00.000Z',
        resolutionNote: 'The valuation report explains the increase.',
      });
      expect(await caseRow(caseId)).toMatchObject({
        status: 'ready-for-determination',
        openClarifications: 0,
      });
      const entries = await timeline(caseId);
      expect(entries.slice(-3)).toEqual([
        ['clarification-resolved', `Clarification ${String(clarification.reference)} resolved`],
        ['status-changed', 'Status changed from awaiting-clarification to clarified'],
        ['status-changed', 'Status changed from clarified to ready-for-determination'],
      ]);
      expect(await events('clarification.resolved.v1')).toMatchObject([
        { subject: clarification.id, data: { clarificationId: clarification.id, caseId } },
      ]);
      expect((await events('review.case.status-changed.v1')).map((event) => event.data)).toEqual([
        { caseId, from: 'assigned', to: 'awaiting-clarification' },
        { caseId, from: 'awaiting-clarification', to: 'clarified' },
        { caseId, from: 'clarified', to: 'ready-for-determination' },
      ]);
      await expectNoContentInEvents();

      const again = await resolve(clarification.id);
      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({ code: 'clarification-not-responded' });
    });

    it('only a responded clarification is resolved: issued or overdue is 409, and nothing changes', async () => {
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);

      const early = await resolve(clarification.id);
      expect(early.statusCode).toBe(409);
      expect(early.json()).toMatchObject({
        type: 'clarification-not-responded',
        code: 'clarification-not-responded',
        clarificationStatus: 'issued',
      });

      await api.app
        .get(ClarificationActivities)
        .markOverdue({ tenant: 'psc', clarificationId: clarification.id });
      const overdue = await resolve(clarification.id);
      expect(overdue.statusCode).toBe(409);
      expect(overdue.json()).toMatchObject({
        code: 'clarification-not-responded',
        clarificationStatus: 'overdue',
      });

      expect(await row(clarification.id)).toMatchObject({ status: 'overdue', resolvedAt: null });
      expect(await events('clarification.resolved.v1')).toEqual([]);
      expect(await caseRow(caseId)).toMatchObject({
        status: 'awaiting-clarification',
        openClarifications: 1,
      });
    });

    it('resolving one of two open clarifications keeps the case awaiting clarification', async () => {
      const caseId = await givenAssignedCase(api, version);
      const first = await issued(caseId);
      const second = await issued(caseId);
      const textOnly = {
        items: [
          { index: 0, text: 'The plot was revalued.', attachments: [] },
          { index: 1, text: 'Acquired in 2026.', attachments: [] },
        ],
      };
      expect((await respond(first.id, textOnly)).statusCode).toBe(201);
      expect((await respond(second.id, textOnly)).statusCode).toBe(201);
      expect(await workflowResult(first.id)).toEqual({ outcome: 'responded' });

      expect((await resolve(first.id)).statusCode).toBe(200);

      expect(await caseRow(caseId)).toMatchObject({
        status: 'awaiting-clarification',
        openClarifications: 1,
      });

      expect((await resolve(second.id)).statusCode).toBe(200);
      expect(await caseRow(caseId)).toMatchObject({ status: 'ready-for-determination' });
    });

    it('only the assignee resolves, follows up or withdraws', async () => {
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);

      expect((await resolve(clarification.id, reviewerB)).statusCode).toBe(403);
      expect((await withdraw(clarification.id, reviewerB)).statusCode).toBe(403);
      const followUp = await api.send(
        'POST',
        `/v1/review/clarifications/${clarification.id}/follow-up`,
        reviewerB,
      );
      expect(followUp.statusCode).toBe(403);
      expect((await resolve(clarification.id, declarant)).statusCode).toBe(404);
      expect((await row(clarification.id))?.status).toBe('issued');
    });

    it('a follow-up is a new draft with followUpOf, the same items and opening paragraph; issued, it takes a new CLR', async () => {
      const caseId = await givenAssignedCase(api, version);
      const opening = 'The points below relate to registry records.';
      const clarification = await issued(caseId, { ...twoItems, opening });
      expect((await respond(clarification.id)).statusCode).toBe(201);

      const response = await api.send(
        'POST',
        `/v1/review/clarifications/${clarification.id}/follow-up`,
        reviewerA,
      );

      expect(response.statusCode, response.body).toBe(201);
      const followUp = response.json<ClarificationView>();
      expect(
        contractErrors(
          okResponse('/v1/review/clarifications/{clarificationId}/follow-up', 'post', 201),
          followUp,
        ),
      ).toEqual([]);
      expect(followUp).toMatchObject({
        status: 'draft',
        caseId,
        reference: null,
        followUpOf: clarification.id,
        items: twoItems.items,
        opening,
      });
      // In the same transaction as the draft: the timeline says who raised it, of which.
      expect((await timeline(caseId)).at(-1)).toEqual([
        'clarification-follow-up',
        `Further clarification on ${String(clarification.reference)} drafted`,
      ]);
      const [entry] = await api.asPlatform((tx) =>
        tx.select().from(reviewTimeline).where(eq(reviewTimeline.kind, 'clarification-follow-up')),
      );
      expect(entry).toMatchObject({ caseId, ref: followUp.id, actor: 'reviewer-a' });

      // The reviewer resolves the first, then issues the follow-up.
      expect((await resolve(clarification.id)).statusCode).toBe(200);
      const next = await issue(followUp.id);
      expect(next.statusCode, next.body).toBe(200);
      const issuedFollowUp = next.json<ClarificationView>();
      expect(issuedFollowUp.reference).toMatch(/^CLR-PSC-2027-0000002-[0-9A-Z]$/);
      expect(issuedFollowUp).toMatchObject({ status: 'issued', followUpOf: clarification.id });
      expect(await caseRow(caseId)).toMatchObject({
        status: 'awaiting-clarification',
        openClarifications: 1,
      });
    });

    it('withdraws: withdrawn, the letter revoked as issued in error, event, clock ended, case back to assigned', async () => {
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);
      const documentId = await letterOf(clarification.id);

      const response = await withdraw(clarification.id);

      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<ClarificationView>();
      expect(
        contractErrors(
          okResponse('/v1/review/clarifications/{clarificationId}/withdraw', 'post'),
          body,
        ),
      ).toEqual([]);
      expect(body).toMatchObject({
        status: 'withdrawn',
        letter: { documentId, status: 'revoked' },
      });
      expect(api.documents.revoked).toEqual([
        { documentId, tenant: 'psc', reason: 'issued-in-error' },
      ]);
      expect(await row(clarification.id)).toMatchObject({
        withdrawnReason: 'Sent to the wrong declarant file.',
      });
      expect(await events('clarification.withdrawn.v1')).toMatchObject([
        { subject: clarification.id, data: { clarificationId: clarification.id, caseId } },
      ]);
      expect(await caseRow(caseId)).toMatchObject({ status: 'assigned', openClarifications: 0 });
      expect(await workflowResult(clarification.id)).toEqual({ outcome: 'withdrawn' });
      await expectNoContentInEvents();

      // The declarant sees it withdrawn, without a letter link.
      const mine = await api.get(`/v1/me/clarifications/${clarification.id}`, declarant);
      expect(mine.json()).toMatchObject({ status: 'withdrawn', letterDownloadUrl: null });

      const again = await withdraw(clarification.id);
      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({ code: 'clarification-not-open' });
      const followUp = await api.send(
        'POST',
        `/v1/review/clarifications/${clarification.id}/follow-up`,
        reviewerA,
      );
      expect(followUp.statusCode).toBe(409);
      expect(followUp.json()).toMatchObject({ code: 'not-followable' });
    });

    it('withdrawing when documents cannot revoke the letter is 503 and changes nothing', async () => {
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);
      await letterOf(clarification.id);
      api.documents.failCalls(1);

      const response = await withdraw(clarification.id);

      expect(response.statusCode).toBe(503);
      expect(await row(clarification.id)).toMatchObject({ status: 'issued' });
      expect(await events('clarification.withdrawn.v1')).toEqual([]);
      expect(await caseRow(caseId)).toMatchObject({ status: 'awaiting-clarification' });
    });
  });

  describe('S13: what the clock does, against the database', () => {
    const activities = () => api.app.get(ClarificationActivities);

    it('the clock is the issue time and the due date stored at issue, from the Commission’s reply window', async () => {
      api.directory.givenCommission('psc', { issueWindowMonths: 6, replyWindowDays: 45 });
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);

      expect(clarification.dueAt).toBe('2028-02-03T08:00:00.000Z');
      expect(
        await activities().clarificationClock({ tenant: 'psc', clarificationId: clarification.id }),
      ).toEqual({ issuedAt: '2027-12-20T08:00:00.000Z', dueAt: '2028-02-03T08:00:00.000Z' });
    });

    it('a policy change after issue does not move the due date the clock runs to', async () => {
      api.directory.givenCommission('psc', { issueWindowMonths: 6, replyWindowDays: 45 });
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);

      api.directory.givenCommission('psc', { issueWindowMonths: 6, replyWindowDays: 10 });

      expect(
        await activities().clarificationClock({ tenant: 'psc', clarificationId: clarification.id }),
      ).toEqual({ issuedAt: '2027-12-20T08:00:00.000Z', dueAt: '2028-02-03T08:00:00.000Z' });
    });

    it('day 20: the reminder goes by email and SMS with the days left, recorded once', async () => {
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);
      await vi.waitFor(
        () => {
          expect(api.notifications.sent).toHaveLength(2);
        },
        { timeout: 45_000, interval: 250 },
      );
      api.clock.set('2028-01-09T08:00:00.000Z');
      const input = { tenant: 'psc', clarificationId: clarification.id };

      expect(
        await activities().notifyDeclarant({ ...input, notice: 'reminder', channel: 'email' }),
      ).toBe('sent');
      expect(
        await activities().notifyDeclarant({ ...input, notice: 'reminder', channel: 'sms' }),
      ).toBe('sent');
      expect(await activities().recordReminder(input)).toBe(true);
      expect(await activities().recordReminder(input)).toBe(false);

      expect(api.notifications.sent.slice(2)).toEqual([
        expect.objectContaining({
          channel: 'email',
          personId: version.personId,
          template: 'clarification-reminder-email',
          params: {
            commissionName: 'Public Service Commission',
            reference: clarification.reference,
            dueDate: '2028-01-19',
            daysLeft: 10,
            portalUrl: `http://localhost:3010/clarifications/${clarification.id}`,
          },
        }),
        expect.objectContaining({ channel: 'sms', template: 'clarification-reminder-sms' }),
      ]);
      expect(await events('clarification.reminder-sent.v1')).toMatchObject([
        { subject: clarification.id, data: { clarificationId: clarification.id, caseId } },
      ]);
      expect((await timeline(caseId)).map(([kind]) => kind)).toContain(
        'clarification-reminder-sent',
      );
    });

    it('day 30 without a response: overdue, event, once', async () => {
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);
      const input = { tenant: 'psc', clarificationId: clarification.id };

      expect(await activities().markOverdue(input)).toBe(true);
      expect(await activities().markOverdue(input)).toBe(false);

      expect(await row(clarification.id)).toMatchObject({ status: 'overdue' });
      expect(await events('clarification.overdue.v1')).toMatchObject([
        {
          subject: clarification.id,
          tenant: 'psc',
          data: { clarificationId: clarification.id, caseId },
        },
      ]);
      expect((await timeline(caseId)).map(([kind]) => kind)).toContain('clarification-overdue');
      // Still open on the case: spec 08 escalates.
      expect(await caseRow(caseId)).toMatchObject({ openClarifications: 1 });
    });

    it('after a response: no reminder, nothing recorded, never overdue', async () => {
      const caseId = await givenAssignedCase(api, version);
      const clarification = await issued(caseId);
      expect((await respond(clarification.id)).statusCode).toBe(201);
      const input = { tenant: 'psc', clarificationId: clarification.id };
      const before = api.notifications.sent.length;

      expect(
        await activities().notifyDeclarant({ ...input, notice: 'reminder', channel: 'email' }),
      ).toBe('skipped');
      expect(await activities().recordReminder(input)).toBe(false);
      expect(await activities().markOverdue(input)).toBe(false);

      expect(api.notifications.sent.slice(before).map((message) => message.template)).not.toContain(
        'clarification-reminder-email',
      );
      expect(await row(clarification.id)).toMatchObject({ status: 'responded' });
      expect(await events('clarification.overdue.v1')).toEqual([]);
    });
  });
});
