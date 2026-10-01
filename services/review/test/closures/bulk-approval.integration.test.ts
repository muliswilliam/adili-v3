import { randomUUID } from 'node:crypto';
import type { Principal } from '@adili/api-kit';
import { parse } from '@adili/numbering';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { BulkClosuresService } from '../../src/closures/bulk-closures.service.js';
import { CLOSURE_SWEEP_WORKFLOW } from '../../src/closures/contract.js';
import type { closureSweep } from '../../src/closures/workflows.js';
import { config } from '../../src/config.js';
import { determinations, outbox, reviewAssignments, reviewCases } from '../../src/db/schema.js';
import { caseIds, givenQueuedCases, temporalOf } from '../support/closures.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';

interface BulkResult {
  approved: number;
  skipped: number;
  firstReference: string | null;
  lastReference: string | null;
  chunks: number;
}

interface LetterDownload {
  documentId: string;
  verificationId: string;
  downloadUrl: string | null;
}

/**
 * S4 at the HTTP seam, with the authorisation rows for bulk approval and the decision letter: a
 * supervisor approves the system's closures of a cycle in chunks of 100 per transaction, each
 * closure numbered in an unbroken `CMP` sequence, its case `determined` and its declarant told by
 * person, with no letter rendered; the letter of one is issued on its first request and served
 * after that, to staff and to the declarant.
 */
describe('bulk approval of closures and on-demand letters (S4)', () => {
  let api: ReviewApi;

  const supervisor: Caller = {
    sub: 'supervisor-s',
    tenant: 'psc',
    roles: ['supervisor'],
    name: 'Samuel Njoroge',
  };
  const reviewer: Caller = { sub: 'reviewer-a', tenant: 'psc', roles: ['reviewer'] };
  const tscSupervisor: Caller = { sub: 'supervisor-t', tenant: 'tsc', roles: ['supervisor'] };
  const helpdesk: Caller = { sub: 'helpdesk-h', tenant: 'psc', roles: ['helpdesk'] };
  const stranger: Caller = { sub: 'declarant-x', roles: ['declarant'], personId: randomUUID() };

  const CLOSURES = '/v1/commissions/psc/closures?cycleYear=2027';

  beforeAll(async () => {
    api = await startReviewApi();
  });

  afterAll(async () => {
    await api.close();
  });

  beforeEach(async () => {
    await api.reset();
    api.directory.givenCommission('psc');
    api.directory.givenCommission('tsc');
    api.clock.set('2028-07-01T06:00:00.000Z');
  });

  /** `count` cases of the cycle swept into system closure proposals (no sample, to count them). */
  async function givenProposals(count: number, tenant = 'psc'): Promise<string[]> {
    const ids = await givenQueuedCases(api, tenant, caseIds(count, { sampled: false }));
    await temporalOf(api).workflow.execute<typeof closureSweep>(CLOSURE_SWEEP_WORKFLOW, {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: `closure-sweep-test-${randomUUID()}`,
      args: [{ tenant, cycleYear: 2027, sampleRate: 0, sweepId: randomUUID() }],
    });
    return ids;
  }

  const approveAll = (caller: Caller, url = CLOSURES, key = randomUUID()) =>
    api.send('POST', url, caller, undefined, { 'idempotency-key': key });

  const closures = () =>
    api.asPlatform((tx) =>
      tx.select().from(determinations).where(eq(determinations.outcome, 'compliant-no-issues')),
    );

  it('S4: approves 250 in three chunks with 250 consecutive CMP numbers, no letters', async () => {
    const cases = await givenProposals(250);

    const response = await approveAll(supervisor);

    expect(response.statusCode, response.body).toBe(200);
    const result = response.json<BulkResult>();
    expect(contractErrors(okResponse('/v1/commissions/{slug}/closures', 'post'), result)).toEqual(
      [],
    );
    expect(result).toMatchObject({ approved: 250, skipped: 0, chunks: 3 });

    // Gapless across chunks: sequences 1 to 250, of PSC and the year of approval, in order.
    const approved = await closures();
    expect(approved).toHaveLength(250);
    const sequences = approved
      .map((row) => parse(row.reference ?? ''))
      .map(({ issuer, period, sequence }) => {
        expect({ issuer, period }).toEqual({ issuer: 'PSC', period: 2028 });
        return sequence;
      })
      .sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 250 }, (_, index) => index + 1));
    expect(parse(result.firstReference ?? '').sequence).toBe(1);
    expect(parse(result.lastReference ?? '').sequence).toBe(250);
    for (const row of approved) {
      expect(row).toMatchObject({
        status: 'approved',
        approver: 'supervisor-s',
        approverName: 'Samuel Njoroge',
        approvedAt: new Date('2028-07-01T06:00:00.000Z'),
        letterDocumentId: null,
      });
    }

    // Every case determined through the status transitions, with its events.
    const statuses = await api.asPlatform((tx) =>
      tx
        .select({ status: reviewCases.status })
        .from(reviewCases)
        .where(inArray(reviewCases.id, cases)),
    );
    expect(statuses.every(({ status }) => status === 'determined')).toBe(true);
    const events = (await api.asPlatform((tx) => tx.select().from(outbox))).map(
      (row) => row.envelope,
    );
    expect(events.filter((event) => event.type === 'determination.approved.v1')).toHaveLength(250);
    expect(
      events.filter(
        (event) =>
          event.type === 'review.case.status-changed.v1' &&
          (event.data as { to: string }).to === 'determined',
      ),
    ).toHaveLength(250);

    // Declarants told by person, by email and SMS; no letter rendered.
    await vi.waitFor(
      () => {
        expect(api.notifications.sent).toHaveLength(500);
      },
      { timeout: 55_000, interval: 250 },
    );
    const persons = new Set(approved.map((row) => row.personId));
    expect(new Set(api.notifications.sent.map((message) => message.personId))).toEqual(persons);
    expect(api.notifications.sent.map((message) => message.template).sort()).toEqual(
      [
        ...Array.from({ length: 250 }, () => 'decision-email'),
        ...Array.from({ length: 250 }, () => 'decision-sms'),
      ].sort(),
    );
    expect(api.documents.issued).toEqual([]);

    // Nothing left: a new request approves nothing; the summary counts the approved.
    const again = await approveAll(supervisor);
    expect(again.json<BulkResult>()).toEqual({
      approved: 0,
      skipped: 0,
      firstReference: null,
      lastReference: null,
      chunks: 0,
    });
    const summary = await api.get(CLOSURES, supervisor);
    expect(summary.json()).toMatchObject({ eligibleProposed: 0, approved: 250 });
  }, 120_000);

  it('S4: the same key replays; resent after a failure, the approval resumes', async () => {
    await givenProposals(30);
    const key = randomUUID();

    const first = await approveAll(supervisor, CLOSURES, key);
    const replay = await approveAll(supervisor, CLOSURES, key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json()).toEqual(first.json());

    // As when the first attempt failed part way and its key was freed: the service runs again
    // under the same key, approves what is left and reports the whole approval.
    await givenProposals(120);
    const principal: Principal = {
      subject: 'supervisor-s',
      tenant: 'psc',
      roles: ['supervisor'],
      scopes: [],
      clientId: 'console',
      name: 'Samuel Njoroge',
      issuedAt: null,
      personId: null,
      acr: null,
      authTime: null,
      tokenId: null,
    };
    const resumed = await api.app
      .get(BulkClosuresService)
      .approve(principal, 'psc', { cycleYear: 2027 }, key);
    expect(resumed.approved).toBe(150);
    expect(resumed.chunks).toBe(3);
    expect(parse(resumed.firstReference ?? '').sequence).toBe(1);
    expect(parse(resumed.lastReference ?? '').sequence).toBe(150);
  });

  it('S4: filters by reporting entity and type, and skips the cases the supervisor once held', async () => {
    const cases = await givenProposals(5);
    const entity = randomUUID();
    await api.asPlatform(async (tx) => {
      await tx
        .update(reviewCases)
        .set({ type: 'initial' })
        .where(eq(reviewCases.id, cases[0] ?? ''));
      await tx
        .update(reviewCases)
        .set({ reportingEntityId: entity })
        .where(inArray(reviewCases.id, [cases[2] ?? '', cases[3] ?? '']));
      await tx.insert(reviewAssignments).values({
        id: randomUUID(),
        tenant: 'psc',
        caseId: cases[1] ?? '',
        subject: 'supervisor-s',
        subjectName: 'Samuel Njoroge',
        kind: 'claimed',
        by: 'supervisor-s',
      });
    });

    const summary = await api.get(`${CLOSURES}&reportingEntityId=${entity}`, supervisor);
    expect(summary.json()).toMatchObject({ eligibleProposed: 2, approved: 0 });
    const ofEntity = await approveAll(supervisor, `${CLOSURES}&reportingEntityId=${entity}`);
    expect(ofEntity.statusCode, ofEntity.body).toBe(200);
    expect(ofEntity.json<BulkResult>()).toMatchObject({ approved: 2, skipped: 0 });
    expect(
      (await closures())
        .filter((row) => row.status === 'approved')
        .map((row) => row.caseId)
        .sort(),
    ).toEqual([cases[2], cases[3]].sort());

    const biennial = await approveAll(supervisor, `${CLOSURES}&type=biennial`);

    expect(biennial.json<BulkResult>()).toMatchObject({ approved: 1, skipped: 1, chunks: 1 });
    const initial = await approveAll(supervisor, `${CLOSURES}&type=initial`);
    expect(initial.json<BulkResult>()).toMatchObject({ approved: 1, skipped: 0 });
  });

  it('authorisation: bulk approve and its summary are for supervisors of the Commission', async () => {
    await givenProposals(3);
    await givenProposals(2, 'tsc');

    const byReviewer = await approveAll(reviewer);
    expect(byReviewer.statusCode).toBe(403);
    expect(byReviewer.json()).toMatchObject({ type: 'supervisor-required' });
    expect((await api.get(CLOSURES, reviewer)).statusCode).toBe(403);

    for (const caller of [tscSupervisor, helpdesk, stranger]) {
      expect((await approveAll(caller)).statusCode).toBe(404);
      expect((await api.get(CLOSURES, caller)).statusCode).toBe(404);
    }
    expect((await approveAll(supervisor, `${CLOSURES}&reportingEntityId=nope`)).statusCode).toBe(
      400,
    );
    expect(
      (await api.send('POST', CLOSURES, supervisor)).statusCode,
      'an idempotency key is required',
    ).toBe(400);

    // Nothing was approved in either Commission by any refused call.
    expect((await closures()).every((row) => row.status === 'proposed')).toBe(true);
  });

  it('S4: the letter of a bulk closure is issued on its first request, once, then served', async () => {
    await givenProposals(3);
    await approveAll(supervisor);
    const [closure, other] = await closures();
    if (!closure || !other) throw new Error('no closures');
    expect(api.documents.issued).toEqual([]);
    const url = `/v1/review/determinations/${closure.id}/letter`;

    const staff = await api.get(url, reviewer);

    expect(staff.statusCode, staff.body).toBe(200);
    expect(
      contractErrors(
        okResponse('/v1/review/determinations/{determinationId}/letter', 'get'),
        staff.json(),
      ),
    ).toEqual([]);
    const letter = staff.json<LetterDownload>();
    expect(letter.downloadUrl).toBeNull();
    expect(api.documents.issued).toHaveLength(1);
    const [issued] = api.documents.issued;
    expect(issued?.request).toMatchObject({
      type: 'decision-letter',
      subjectRef: `determination:${closure.id}`,
      subjectPersonId: closure.personId,
      payload: { determinationId: closure.id },
    });
    expect(issued?.tenant).toBe('psc');
    expect(issued?.pulled).toMatchObject({
      status: 200,
      body: { determinationReference: closure.reference, outcome: 'compliant-no-issues' },
    });
    expect(letter).toMatchObject({
      documentId: issued?.document.id,
      verificationId: issued?.document.verificationId,
    });

    // Served after that, to staff and to the declarant (owner): the same document, no new one.
    const declarant: Caller = {
      sub: 'declarant-owner',
      roles: ['declarant'],
      personId: closure.personId,
    };
    const again = await api.get(url, supervisor);
    const own = await api.get(url, declarant);
    expect(again.json<LetterDownload>().documentId).toBe(letter.documentId);
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json<LetterDownload>()).toMatchObject({
      documentId: letter.documentId,
      downloadUrl: expect.stringContaining(`api/documents/${letter.documentId}/download`) as string,
    });
    expect(api.documents.issued).toHaveLength(1);
    const read = await api.get(`/v1/review/determinations/${closure.id}`, reviewer);
    expect(read.json()).toMatchObject({ letterAvailable: true });

    // The declarant's own first request issues theirs too.
    const otherOwner: Caller = {
      sub: 'declarant-other',
      roles: ['declarant'],
      personId: other.personId,
    };
    expect(
      (await api.get(`/v1/review/determinations/${other.id}/letter`, otherOwner)).statusCode,
    ).toBe(200);
    expect(api.documents.issued).toHaveLength(2);
  });

  it("audit: staff reads of the letter are recorded, even with a person id; a declarant's own read is not", async () => {
    await givenProposals(1);
    await approveAll(supervisor);
    const [closure] = await closures();
    if (!closure) throw new Error('no closures');
    const url = `/v1/review/determinations/${closure.id}/letter`;
    const letterReads = async () =>
      (await api.asPlatform((tx) => tx.select().from(outbox)))
        .map((event) => event.envelope)
        .filter(
          (envelope) =>
            envelope.type === 'audit.read.v1' &&
            (envelope.data as { action?: string }).action ===
              'review.determination.letter.downloaded',
        );
    const owner: Caller = {
      sub: 'declarant-owner',
      roles: ['declarant'],
      personId: closure.personId,
    };
    // A staff token that also names a person (none should, but nothing forbids it).
    const staffWithPerson: Caller = { ...reviewer, personId: closure.personId };

    expect((await api.get(url, owner)).statusCode).toBe(200);
    expect(await letterReads()).toEqual([]);

    expect((await api.get(url, staffWithPerson)).statusCode).toBe(200);
    expect(await letterReads()).toEqual([
      expect.objectContaining({
        tenant: 'psc',
        data: expect.objectContaining({
          actor: expect.objectContaining({ subject: reviewer.sub }) as unknown,
        }) as unknown,
      }),
    ]);
  });

  it('authorisation: the letter is for the Commission staff and its declarant only', async () => {
    await givenProposals(2);
    const [proposed] = await closures();
    if (!proposed) throw new Error('no closures');
    const proposedUrl = `/v1/review/determinations/${proposed.id}/letter`;

    // Not approved: staff get 409; the declarant cannot see a proposal (404).
    const early = await api.get(proposedUrl, supervisor);
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ type: 'not-approved' });
    const owner: Caller = {
      sub: 'declarant-owner',
      roles: ['declarant'],
      personId: proposed.personId,
    };
    expect((await api.get(proposedUrl, owner)).statusCode).toBe(404);

    await approveAll(supervisor);
    for (const caller of [tscSupervisor, helpdesk, stranger]) {
      expect((await api.get(proposedUrl, caller)).statusCode).toBe(404);
    }
    expect(api.documents.issued).toEqual([]);

    // Documents down: 503, nothing stored, and the next request issues it.
    api.documents.failCalls(1);
    const down = await api.get(proposedUrl, owner);
    expect(down.statusCode).toBe(503);
    expect(down.json()).toMatchObject({ type: 'documents-unavailable' });
    expect((await api.get(proposedUrl, owner)).statusCode).toBe(200);
    expect(api.documents.issued).toHaveLength(1);
  });
});
