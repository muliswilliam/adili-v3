import { randomUUID } from 'node:crypto';

import { asc, eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DraftClarificationInput } from '../../src/ai-gateway/ai-gateway-client.js';
import { CopilotDraftPurge } from '../../src/copilot/copilot-draft-purge.js';
import type { CopilotDraft } from '../../src/copilot/copilot-drafts.service.js';
import {
  clarifications,
  outbox,
  reviewCases,
  reviewCopilotDrafts,
  reviewCopilots,
  reviewFlags,
} from '../../src/db/schema.js';
import { asset, declaration, income, revalued, statement } from '../fixtures/declarations.js';
import { processed, twoVersions } from '../support/cases.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';

/**
 * S12 at the review service's seams (spec 07c): Draft with AI. The assignee's selected flags and
 * items become the `draft-clarification` input (a fake gateway), the draft answers within the
 * wait or is polled, its items come in the clarification item shape, and no clarification is
 * created.
 */
describe('review copilot drafts', () => {
  let api: ReviewApi;

  const assignee: Caller = { sub: 'reviewer-a', tenant: 'psc', roles: ['reviewer'] };
  const otherReviewer: Caller = { sub: 'reviewer-b', tenant: 'psc', roles: ['reviewer'] };
  const supervisor: Caller = { sub: 'supervisor-s', tenant: 'psc', roles: ['supervisor'] };
  const tscReviewer: Caller = { sub: 'reviewer-t', tenant: 'tsc', roles: ['reviewer'] };

  const draftsPath = (caseId: string) => `/v1/review/cases/${caseId}/copilot/drafts`;
  const draftPath = (draftId: string) => `/v1/review/copilot/drafts/${draftId}`;

  // Drafted text that must never reach the review database.
  const DRAFTED = 'Eleza ongezeko la thamani ya shamba la Karen Ridge.';

  beforeAll(async () => {
    api = await startReviewApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    api.directory.givenCommission('psc');
    api.directory.givenCommission('tsc');
  });

  const land = asset({ description: 'Plot at Karen Ridge', value: { kesCents: 1_000_000_000 } });
  const salary = income();
  // The land in the amendment: a new item id, the value up 30%.
  const raised = revalued(land, 1_300_000_000);

  /** The amendment's case (the land up 30%, flagged), assigned to reviewer-a. */
  const flaggedCase = async () => {
    const { first, second } = twoVersions(
      {
        tenant: 'psc',
        submittedAt: '2027-12-15T09:30:00.000Z',
        document: declaration([statement('officer', { income: [salary], assets: [land] })]),
      },
      {
        submittedAt: '2028-01-20T08:00:00.000Z',
        document: declaration([statement('officer', { income: [salary], assets: [raised] })]),
      },
    );
    api.declarations.given(first, second);
    await processed(api, first);
    const caseId = await processed(api, second);
    await api.asPlatform((tx) =>
      tx
        .update(reviewCases)
        .set({
          status: 'assigned',
          assignee: 'reviewer-a',
          assigneeName: 'A',
          claimedAt: new Date(),
        })
        .where(eq(reviewCases.id, caseId)),
    );
    const flags = await api.asPlatform((tx) =>
      tx
        .select()
        .from(reviewFlags)
        .where(eq(reviewFlags.caseId, caseId))
        .orderBy(asc(reviewFlags.createdAt)),
    );
    const flag = flags.find((f) => f.itemRefs.some((ref) => ref.itemId === raised.id));
    if (!flag) throw new Error('no flag on the land');
    return { caseId, flagId: flag.id };
  };

  const output = (input: DraftClarificationInput) => ({
    label: {
      aiAssisted: true,
      task: 'draft-clarification',
      promptVersion: 2,
      provider: 'replay',
      model: 'claude-opus-5-5',
      generatedAt: '2028-01-20T08:05:00.000Z',
      disclaimer: 'Viashiria, si matokeo. Afisa aliyetajwa ndiye anayeamua.',
    },
    opening: 'Ombi hili linahusu kiwanja cha Karen Ridge.',
    items: input.selections.map((selection) => ({
      ref: selection.ref,
      requirement: selection.requirement ?? 'explain-discrepancy',
      text: DRAFTED,
    })),
  });

  const draftInput = (flagId: string) => ({
    flagIds: [flagId],
    itemRefs: [
      {
        personKey: 'officer',
        itemId: raised.id,
        sectionKey: 'statement:officer',
        requirement: null,
      },
    ],
    language: 'sw',
  });

  const post = (caseId: string, body: unknown, caller = assignee, key = randomUUID()) =>
    api.send('POST', draftsPath(caseId), caller, body, { 'idempotency-key': key });

  const conforms = (body: unknown, path: string, method: 'get' | 'post', status: number) => {
    expect(contractErrors(okResponse(path, method, status), body)).toEqual([]);
  };

  const draftRows = () => api.asPlatform((tx) => tx.select().from(reviewCopilotDrafts));

  const eventsOf = async (type: string) =>
    (
      await api.asPlatform((tx) =>
        tx.select().from(outbox).where(eq(outbox.eventType, type)).orderBy(asc(outbox.createdAt)),
      )
    ).map((row) => row.envelope);

  it('answers 200 with the items in the clarification item shape when the draft is ready within the wait', async () => {
    const { caseId, flagId } = await flaggedCase();
    api.ai.endWithinWait((call) => ({
      status: 'succeeded',
      reason: null,
      output: output(call.request.input as DraftClarificationInput),
    }));

    const response = await post(caseId, draftInput(flagId));

    expect(response.statusCode).toBe(200);
    const draft = response.json<CopilotDraft>();
    conforms(draft, '/v1/review/cases/{caseId}/copilot/drafts', 'post', 200);
    expect(draft).toEqual({
      id: expect.any(String) as string,
      status: 'ready',
      jobId: api.ai.jobsOf('draft-clarification')[0]?.id,
      label: expect.objectContaining({ aiAssisted: true, task: 'draft-clarification' }) as object,
      opening: 'Ombi hili linahusu kiwanja cha Karen Ridge.',
      items: [
        {
          sectionKey: 'statement:officer',
          personKey: 'officer',
          itemId: raised.id,
          requirement: 'explain-discrepancy',
          text: DRAFTED,
          aiJobId: api.ai.jobsOf('draft-clarification')[0]?.id,
        },
      ],
      failureReason: null,
    });

    // The task input: the item with its context and its flag, in Swahili, waiting 10 s.
    const [call] = api.ai.calls;
    expect(call).toMatchObject({
      task: 'draft-clarification',
      waitSeconds: 10,
      request: {
        tenant: 'psc',
        dataClass: 'synthetic',
        subjectRef: `review-case:${caseId}`,
        // v2: the opening is a lead-in to the letter's own introduction, not a second one.
        promptVersion: 2,
        input: {
          kind: 'draft-clarification',
          commissionName: expect.any(String) as string,
          language: 'sw',
          selections: [
            {
              ref: { sectionKey: 'statement:officer', personKey: 'officer', itemId: raised.id },
              flag: expect.objectContaining({ id: flagId }) as object,
              itemContext: expect.objectContaining({
                description: 'Plot at Karen Ridge',
              }) as object,
              requirement: null,
            },
          ],
        },
      },
    });
    // The declaration was read for the case as the reviewer; the answer is an audited read.
    expect(api.declarations.reads).toContainEqual(
      expect.objectContaining({ actingSubject: 'reviewer-a', caseId }),
    );
    expect((await eventsOf('audit.read.v1')).map((event) => event.data)).toEqual([
      expect.objectContaining({ action: 'review.copilot.drafted' }),
    ]);

    // No clarification is created, and the drafted text is stored only encrypted.
    expect(await api.asPlatform((tx) => tx.select().from(clarifications))).toEqual([]);
    const rows = await draftRows();
    expect(rows).toEqual([
      expect.objectContaining({ id: draft.id, caseId, requestedBy: 'reviewer-a', status: 'ready' }),
    ]);
    const stored = await api.asPlatform((tx) =>
      tx.execute<{ row: string }>(sql`select t::text as row from review_copilot_drafts t`),
    );
    expect(stored.rows.map((r) => r.row).join('\n')).not.toContain('Karen');
    // Nor is the answer kept in clear for the Idempotency-Key's replay.
    const replays = await api.asPlatform((tx) =>
      tx.execute<{ row: string }>(sql`select t::text as row from idempotency_keys t`),
    );
    expect(replays.rows.map((r) => r.row).join('\n')).not.toContain(DRAFTED);
  });

  it('a retry with the same key gets the same draft, another selection a 422, and once its 24 hours are over a 409', async () => {
    const { caseId, flagId } = await flaggedCase();
    api.ai.endWithinWait((call) => ({
      status: 'succeeded',
      reason: null,
      output: output(call.request.input as DraftClarificationInput),
    }));
    const key = randomUUID();
    const first = (await post(caseId, draftInput(flagId), assignee, key)).json<CopilotDraft>();
    const again = await post(caseId, draftInput(flagId), assignee, key);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first);
    expect(api.ai.jobsOf('draft-clarification')).toHaveLength(1);

    await api.asPlatform((tx) =>
      tx
        .update(reviewCopilotDrafts)
        .set({ expiresAt: sql`now() - interval '1 second'` })
        .where(eq(reviewCopilotDrafts.id, first.id)),
    );
    const expired = await post(caseId, draftInput(flagId), assignee, key);
    expect(expired.statusCode).toBe(409);
    expect(expired.json()).toMatchObject({ type: 'draft-expired' });
    expect(expired.body).not.toContain(DRAFTED);
    // The same key for another selection.
    const reused = await post(caseId, { ...draftInput(flagId), language: 'en' }, assignee, key);
    expect(reused.statusCode).toBe(422);
    expect(reused.json()).toMatchObject({ type: 'idempotency-key-reused' });
  });

  it('answers 202 with a pending draft when the wait runs out, which the assignee polls until ready', async () => {
    const { caseId, flagId } = await flaggedCase();
    const key = randomUUID();

    const response = await post(caseId, draftInput(flagId), assignee, key);

    expect(response.statusCode).toBe(202);
    const pending = response.json<CopilotDraft>();
    conforms(pending, '/v1/review/cases/{caseId}/copilot/drafts', 'post', 202);
    expect(pending).toMatchObject({ status: 'pending', label: null, opening: null, items: [] });

    const polled = await api.get(draftPath(pending.id), assignee);
    expect(polled.statusCode).toBe(200);
    expect(polled.json()).toEqual(pending);

    // A retry of the request gets the same draft and the same job.
    const retry = await post(caseId, draftInput(flagId), assignee, key);
    expect(retry.json<CopilotDraft>().id).toBe(pending.id);
    expect(api.ai.jobsOf('draft-clarification')).toHaveLength(1);

    const job = api.ai.jobsOf('draft-clarification')[0];
    if (!job || !pending.jobId) throw new Error('no job');
    expect(pending.jobId).toBe(job.id);
    api.ai.succeed(job.id, output(api.ai.calls[0]?.request.input as DraftClarificationInput));

    const ready = await api.get(draftPath(pending.id), assignee);
    expect(ready.statusCode).toBe(200);
    conforms(ready.json(), '/v1/review/copilot/drafts/{draftId}', 'get', 200);
    expect(ready.json()).toMatchObject({
      id: pending.id,
      status: 'ready',
      items: [expect.objectContaining({ itemId: raised.id, text: DRAFTED })],
    });
    expect((await draftRows())[0]).toMatchObject({ status: 'ready' });
    expect(await api.asPlatform((tx) => tx.select().from(clarifications))).toEqual([]);
  });

  it('serves a ready draft from its own encrypted copy, also once the gateway purged the job output', async () => {
    const { caseId, flagId } = await flaggedCase();
    const pending = (await post(caseId, draftInput(flagId))).json<CopilotDraft>();
    const job = api.ai.jobsOf('draft-clarification')[0];
    if (!job) throw new Error('no job');
    api.ai.succeed(job.id, output(api.ai.calls[0]?.request.input as DraftClarificationInput));
    expect((await api.get(draftPath(pending.id), assignee)).json()).toMatchObject({
      status: 'ready',
    });

    // The gateway's retention purged the output (or lost the job): the draft still reads.
    job.output = null;
    job.status = 'failed';
    const later = await api.get(draftPath(pending.id), assignee);
    expect(later.statusCode).toBe(200);
    expect(later.json()).toMatchObject({
      status: 'ready',
      opening: 'Ombi hili linahusu kiwanja cha Karen Ridge.',
      items: [{ itemId: raised.id, text: DRAFTED, aiJobId: job.id }],
    });
    const [row] = await draftRows();
    expect(row?.ciphertext).toEqual(expect.any(String));
    const stored = await api.asPlatform((tx) =>
      tx.execute<{ row: string }>(sql`select t::text as row from review_copilot_drafts t`),
    );
    expect(stored.rows.map((r) => r.row).join('\n')).not.toContain('Karen');
  });

  it('a retry of a pending draft whose job has ended since answers the ended draft', async () => {
    const { caseId, flagId } = await flaggedCase();
    const key = randomUUID();
    const pending = (await post(caseId, draftInput(flagId), assignee, key)).json<CopilotDraft>();
    api.ai.succeed(
      pending.jobId ?? '',
      output(api.ai.calls[0]?.request.input as DraftClarificationInput),
    );

    const retry = await post(caseId, draftInput(flagId), assignee, key);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ id: pending.id, status: 'ready' });
  });

  it('a draft is polled only while its requester is still the assignee', async () => {
    const { caseId, flagId } = await flaggedCase();
    const draft = (await post(caseId, draftInput(flagId))).json<CopilotDraft>();
    await api.asPlatform((tx) =>
      tx.update(reviewCases).set({ assignee: 'reviewer-b' }).where(eq(reviewCases.id, caseId)),
    );

    expect((await api.get(draftPath(draft.id), assignee)).statusCode).toBe(404);
    expect((await api.get(draftPath(draft.id), otherReviewer)).statusCode).toBe(404);
  });

  it('reports a succeeded job whose output the gateway purged as output-purged (Q24)', async () => {
    const { caseId, flagId } = await flaggedCase();
    const pending = (await post(caseId, draftInput(flagId))).json<CopilotDraft>();
    api.ai.succeed(pending.jobId ?? '', null as unknown as Record<string, unknown>);

    expect((await api.get(draftPath(pending.id), assignee)).json()).toMatchObject({
      status: 'failed',
      failureReason: 'output-purged',
      items: [],
    });
  });

  it('reports a failed job with its reason, and a request the gateway refuses as rejected', async () => {
    const { caseId, flagId } = await flaggedCase();
    const pending = (await post(caseId, draftInput(flagId))).json<CopilotDraft>();
    api.ai.fail(pending.jobId ?? '', 'validation');

    expect((await api.get(draftPath(pending.id), assignee)).json()).toMatchObject({
      status: 'failed',
      failureReason: 'validation',
      items: [],
    });

    api.ai.rejectRequests();
    const rejected = await post(caseId, draftInput(flagId));
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({
      status: 'failed',
      jobId: null,
      failureReason: 'rejected',
    });
  });

  it('a ready draft is rated like any copilot output; a pending one cannot be yet', async () => {
    const { caseId, flagId } = await flaggedCase();
    const feedbackPath = (jobId: string) => `/v1/review/copilot/outputs/${jobId}/feedback`;
    const helpful = { rating: 'helpful', reason: null, note: null };
    const pending = (await post(caseId, draftInput(flagId))).json<CopilotDraft>();
    const jobId = pending.jobId ?? '';

    expect((await api.send('PUT', feedbackPath(jobId), assignee, helpful)).statusCode).toBe(404);

    api.ai.succeed(jobId, output(api.ai.calls[0]?.request.input as DraftClarificationInput));
    expect((await api.get(draftPath(pending.id), assignee)).json()).toMatchObject({
      status: 'ready',
    });
    expect((await api.send('PUT', feedbackPath(jobId), assignee, helpful)).statusCode).toBe(200);
    expect(api.ai.feedback.map((call) => [call.jobId, call.feedback.rating])).toEqual([
      [jobId, 'helpful'],
    ]);
    // A draft is its requester's alone, as its poll is: anyone else, 404.
    expect((await api.send('PUT', feedbackPath(jobId), otherReviewer, helpful)).statusCode).toBe(
      404,
    );

    // Also once the case is theirs: they did not ask for it.
    await api.asPlatform((tx) =>
      tx.update(reviewCases).set({ assignee: 'reviewer-b' }).where(eq(reviewCases.id, caseId)),
    );
    expect((await api.send('PUT', feedbackPath(jobId), otherReviewer, helpful)).statusCode).toBe(
      404,
    );
    expect(api.ai.feedback).toHaveLength(1);
  });

  it('is for the assignee only: another reviewer or a supervisor 403, another Commission 404, and a draft is polled only by who asked', async () => {
    const { caseId, flagId } = await flaggedCase();

    expect((await post(caseId, draftInput(flagId), otherReviewer)).statusCode).toBe(403);
    expect((await post(caseId, draftInput(flagId), supervisor)).statusCode).toBe(403);
    expect((await post(caseId, draftInput(flagId), tscReviewer)).statusCode).toBe(404);
    expect(api.ai.calls).toEqual([]);

    const draft = (await post(caseId, draftInput(flagId))).json<CopilotDraft>();
    expect((await api.get(draftPath(draft.id), otherReviewer)).statusCode).toBe(404);
    expect((await api.get(draftPath(draft.id), tscReviewer)).statusCode).toBe(404);
    expect((await api.get(draftPath(randomUUID()), assignee)).statusCode).toBe(404);
  });

  it('validates the selection against the case: 400 for a flag it does not have or an item its version lacks', async () => {
    const { caseId, flagId } = await flaggedCase();

    const unknownFlag = await post(caseId, { ...draftInput(flagId), flagIds: [randomUUID()] });
    expect(unknownFlag.statusCode).toBe(400);
    expect(unknownFlag.json()).toMatchObject({ type: 'selection-not-on-case' });

    const unknownItem = await post(caseId, {
      flagIds: [],
      itemRefs: [
        { personKey: 'officer', itemId: randomUUID(), sectionKey: null, requirement: null },
      ],
      language: 'en',
    });
    expect(unknownItem.statusCode).toBe(400);
    expect(unknownItem.json()).toMatchObject({ type: 'selection-not-on-case' });

    const empty = await post(caseId, { flagIds: [], itemRefs: [], language: 'en' });
    expect(empty.statusCode).toBe(400);
    expect((await post(caseId, { ...draftInput(flagId), language: 'fr' })).statusCode).toBe(400);
    expect(api.ai.calls).toEqual([]);
  });

  it('is 409 when AI is not enabled for the Commission, and stores nothing', async () => {
    const { caseId, flagId } = await flaggedCase();
    api.ai.blockEverything('policy');

    const blocked = await post(caseId, draftInput(flagId));
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ type: 'ai-not-enabled' });

    expect(await draftRows()).toEqual([]);
  });

  it('asks the gateway even when the case copilot was not enabled: a policy change applies at once', async () => {
    const { caseId, flagId } = await flaggedCase();
    await api.asPlatform((tx) =>
      tx.insert(reviewCopilots).values({
        caseId,
        tenant: 'psc',
        status: 'not-enabled',
        forVersionId: randomUUID(),
        attempt: 1,
        requestedAt: new Date(),
        failureReason: 'policy',
      }),
    );

    const response = await post(caseId, draftInput(flagId));
    expect(response.statusCode).toBe(202);
    expect(api.ai.jobsOf('draft-clarification')).toHaveLength(1);
  });

  it('is 503 when the gateway cannot be reached, and stores nothing', async () => {
    const { caseId, flagId } = await flaggedCase();
    api.ai.failCalls(1);

    const response = await post(caseId, draftInput(flagId));
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'ai-gateway-unavailable' });
    expect(await draftRows()).toEqual([]);
  });

  it("purges drafts' text after 24 hours, keeping which job drafted; until the purge runs, an expired draft is already gone", async () => {
    const { caseId, flagId } = await flaggedCase();
    const old = (await post(caseId, draftInput(flagId))).json<CopilotDraft>();
    const fresh = (await post(caseId, draftInput(flagId))).json<CopilotDraft>();
    await api.asPlatform((tx) =>
      tx
        .update(reviewCopilotDrafts)
        .set({ expiresAt: sql`now() - interval '1 second'` })
        .where(eq(reviewCopilotDrafts.id, old.id)),
    );
    const [row] = (await draftRows()).filter((r) => r.id === fresh.id);
    const ttl = (row?.expiresAt.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0);
    expect(ttl).toBe(24 * 60 * 60 * 1000);

    expect((await api.get(draftPath(old.id), assignee)).statusCode).toBe(404);
    expect(await api.app.get(CopilotDraftPurge).purge()).toBe(1);
    const rows = await draftRows();
    expect(rows.find((r) => r.id === old.id)).toMatchObject({
      jobId: old.jobId,
      ciphertext: null,
      envelope: null,
      purgedAt: expect.any(Date) as Date,
    });
    expect(rows.find((r) => r.id === fresh.id)).toMatchObject({ purgedAt: null });
    // Idempotent: a purged draft is not purged again.
    expect(await api.app.get(CopilotDraftPurge).purge()).toBe(0);
    expect((await api.get(draftPath(old.id), assignee)).statusCode).toBe(404);
  });
});
