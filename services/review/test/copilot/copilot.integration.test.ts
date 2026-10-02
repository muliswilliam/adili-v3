import { randomUUID } from 'node:crypto';

import type { EventEnvelope } from '@adili/events';
import { asc, eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ReviewTask,
  SummarizeDeclarationInput,
} from '../../src/ai-gateway/ai-gateway-client.js';
import type { CopilotView } from '../../src/copilot/copilot.service.js';
import { outbox, reviewCases, reviewCopilots, reviewFlags } from '../../src/db/schema.js';
import { asset, declaration, income, revalued, statement } from '../fixtures/declarations.js';
import { processedFromInbox, twoVersions } from '../support/cases.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type StoredVersion, submittedVersion } from '../support/fake-declarations.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';

/**
 * S10 and S11 at the review service's seams (spec 07c): `DeclarationProcessingWorkflow` requests
 * the copilot from the ai-gateway (a fake), the `ai.job.*` consumer records the outputs encrypted,
 * an amendment or a registry re-check marks them stale and requests them again, and the copilot
 * view and refresh answer the Commission's reviewers.
 */
describe('review copilot', () => {
  let api: ReviewApi;

  const reviewerA: Caller = { sub: 'reviewer-a', tenant: 'psc', roles: ['reviewer'] };
  const reviewerB: Caller = { sub: 'reviewer-b', tenant: 'psc', roles: ['reviewer'] };
  const supervisor: Caller = { sub: 'supervisor-s', tenant: 'psc', roles: ['supervisor'] };
  const tscReviewer: Caller = { sub: 'reviewer-t', tenant: 'tsc', roles: ['reviewer'] };
  const commissionAdmin: Caller = { sub: 'admin-p', tenant: 'psc', roles: ['commission-admin'] };

  const copilotPath = (caseId: string) => `/v1/review/cases/${caseId}/copilot`;
  const refreshPath = (caseId: string) => `/v1/review/cases/${caseId}/copilot/refresh`;

  // Content that must never reach the review database in clear.
  const OVERVIEW = 'The officer declares a plot at Karen Ridge and a salary.';
  const MEANING = 'The declared value of the plot at Karen Ridge rose by 30%.';

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

  /** Version 1 and its amendment: the land up 30% and not marked as changed. */
  const versions = (tenant = 'psc') =>
    twoVersions(
      {
        tenant,
        submittedAt: '2027-12-15T09:30:00.000Z',
        document: declaration([statement('officer', { income: [salary], assets: [land] })]),
      },
      {
        submittedAt: '2028-01-20T08:00:00.000Z',
        document: declaration([
          statement('officer', {
            income: [salary],
            assets: [revalued(land, 1_300_000_000)],
          }),
        ]),
      },
    );

  const label = (task: ReviewTask) => ({
    aiAssisted: true,
    task,
    promptVersion: 1,
    provider: 'replay',
    model: 'claude-opus-5-5',
    generatedAt: '2028-01-20T08:05:00.000Z',
    disclaimer: 'Indicators, not findings. A named officer decides.',
  });

  const summaryOutput = (overview = OVERVIEW) => ({
    label: label('summarize-declaration'),
    overview,
    changesSincePrevious: [],
    sections: [],
    worthAttention: [],
  });

  const explanationsOutput = (flagIds: string[]) => ({
    label: label('explain-flags'),
    explanations: flagIds.map((flagId) => ({
      flagId,
      meaning: MEANING,
      whatToCheck: ['Check the land registry search for the plot.'],
      typicalResolution: 'A valuation report explains the change.',
      refs: [],
    })),
  });

  const copilotRow = async (caseId: string) => {
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(reviewCopilots).where(eq(reviewCopilots.caseId, caseId)),
    );
    return row;
  };

  const flagIdsOf = async (caseId: string) =>
    (
      await api.asPlatform((tx) =>
        tx
          .select({ id: reviewFlags.id })
          .from(reviewFlags)
          .where(eq(reviewFlags.caseId, caseId))
          .orderBy(asc(reviewFlags.createdAt), asc(reviewFlags.id)),
      )
    ).map((flag) => flag.id);

  const eventsOf = async (type: string) =>
    (
      await api.asPlatform((tx) =>
        tx
          .select()
          .from(outbox)
          .where(eq(outbox.eventType, type))
          .orderBy(asc(outbox.createdAt), asc(outbox.id)),
      )
    ).map((row) => row.envelope);

  /** Delivers a job's `ai.job.*` event to the inbox, as the RabbitMQ transport would. */
  const deliver = async (event: ReturnType<ReviewApi['ai']['succeed']>) => {
    if (event.type === 'ai.job.completed.v1') await api.aiJobs.completed(event);
    else if (event.type === 'ai.job.failed.v1') await api.aiJobs.failed(event);
    else await api.aiJobs.blocked(event);
  };

  /** Waits until the case's copilot has `status` (the consumer's workflow runs on Temporal). */
  const untilStatus = (caseId: string, status: string) =>
    vi.waitFor(
      async () => {
        const row = await copilotRow(caseId);
        if (row?.status !== status) throw new Error(`copilot is ${String(row?.status)}`);
        return row;
      },
      { timeout: 45_000, interval: 250 },
    );

  const view = async (caseId: string, caller: Caller = reviewerA) => {
    const response = await api.get(copilotPath(caseId), caller);
    expect(response.statusCode).toBe(200);
    const body = response.json<CopilotView>();
    expect(contractErrors(okResponse('/v1/review/cases/{caseId}/copilot', 'get'), body)).toEqual(
      [],
    );
    return body;
  };

  /** A case created through the inbox, its copilot requested; returns the case and its jobs. */
  const createdCase = async (version: StoredVersion) => {
    const created = await processedFromInbox(api, version);
    const row = await untilStatus(created.id, 'pending');
    return { caseId: created.id, row };
  };

  /** Completes the latest request's jobs and waits for the copilot to be ready. */
  const completeJobs = async (caseId: string, overview = OVERVIEW) => {
    const row = await copilotRow(caseId);
    if (!row?.requestedSummaryJobId) throw new Error('no summarize job');
    await deliver(api.ai.succeed(row.requestedSummaryJobId, summaryOutput(overview)));
    if (row.requestedExplanationsJobId) {
      await deliver(
        api.ai.succeed(row.requestedExplanationsJobId, explanationsOutput(await flagIdsOf(caseId))),
      );
    }
    return untilStatus(caseId, 'ready');
  };

  const assign = (caseId: string, assignee: string) =>
    api.asPlatform((tx) =>
      tx
        .update(reviewCases)
        .set({ status: 'assigned', assignee, assigneeName: assignee, claimedAt: new Date() })
        .where(eq(reviewCases.id, caseId)),
    );

  describe('S10: requested by the workflow, recorded by the consumer', () => {
    it('is pending with two job ids after the case is created, then ready with the outputs stored encrypted', async () => {
      const { first } = versions();
      api.declarations.given(first);

      const { caseId, row } = await createdCase(first);
      const flagIds = await flagIdsOf(caseId);
      expect(flagIds.length).toBeGreaterThan(0);
      expect(row).toMatchObject({
        status: 'pending',
        forVersionId: first.versionId,
        attempt: 1,
        requestedSummaryJobId: api.ai.jobsOf('summarize-declaration')[0]?.id,
        requestedExplanationsJobId: api.ai.jobsOf('explain-flags')[0]?.id,
      });

      // The inputs: the version's document, the case's flags by id, the synthetic demo tenant.
      const [summarize, explain] = api.ai.calls;
      expect(summarize).toMatchObject({
        task: 'summarize-declaration',
        request: {
          tenant: 'psc',
          dataClass: 'synthetic',
          subjectRef: `review-case:${caseId}`,
          input: {
            kind: 'summarize-declaration',
            document: first.document,
            previousDocument: null,
            changes: [],
            registryStatuses: [],
            language: 'en',
          },
        },
      });
      const summarizeInput = summarize?.request.input as SummarizeDeclarationInput | undefined;
      expect(summarizeInput?.flags.map((flag) => flag.id)).toEqual(flagIds);
      expect(explain).toMatchObject({
        task: 'explain-flags',
        request: { input: { kind: 'explain-flags', language: 'en' } },
      });
      expect(summarize?.idempotencyKey).not.toBe(explain?.idempotencyKey);
      // The declaration was read for the case as the service.
      expect(api.declarations.reads).toContainEqual(
        expect.objectContaining({ actingSubject: 'system:review', caseId }),
      );

      const pending = await view(caseId);
      expect(pending).toMatchObject({ status: 'pending', summary: null, explanations: null });

      const ready = await completeJobs(caseId);
      expect(ready.summaryCiphertext).not.toContain('Karen');
      expect(api.cipher.calls.filter((call) => call.operation === 'encrypt')).toEqual([
        expect.objectContaining({ tenant: 'psc' }),
        expect.objectContaining({ tenant: 'psc' }),
      ]);

      const body = await view(caseId, reviewerB);
      expect(body).toEqual({
        status: 'ready',
        forVersionId: first.versionId,
        generatedAt: expect.any(String) as string,
        failureReason: null,
        summary: summaryOutput(),
        explanations: explanationsOutput(flagIds),
        jobs: { summarize: row.requestedSummaryJobId, explain: row.requestedExplanationsJobId },
        feedback: [],
      });

      // review.copilot.updated.v1 for each change of status, with no content.
      const updated = await eventsOf('review.copilot.updated.v1');
      expect(updated.map((event) => event.data)).toEqual([
        { caseId, status: 'pending', forVersionId: first.versionId },
        { caseId, status: 'ready', forVersionId: first.versionId },
      ]);
      // Every view is an audited read.
      const audited = await eventsOf('audit.read.v1');
      expect(audited.map((event) => event.data)).toEqual([
        expect.objectContaining({
          action: 'review.copilot.viewed',
          resource: expect.objectContaining({ type: 'review-case', params: { caseId } }) as object,
          actor: expect.objectContaining({ subject: 'reviewer-a' }) as object,
        }),
        expect.objectContaining({
          action: 'review.copilot.viewed',
          actor: expect.objectContaining({ subject: 'reviewer-b' }) as object,
        }),
      ]);

      // The outputs' content is nowhere in the review database in clear.
      const dump = await api.asPlatform(async (tx) => {
        const tables = await tx.execute<{ table_name: string }>(
          sql`select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE'`,
        );
        const texts: string[] = [];
        for (const { table_name } of tables.rows) {
          const rows = await tx.execute<{ row: string }>(
            sql.raw(`select t::text as row from "${table_name}" t`),
          );
          texts.push(...rows.rows.map((r) => r.row));
        }
        return texts.join('\n');
      });
      expect(dump).toContain(caseId);
      expect(dump).not.toContain(OVERVIEW);
      expect(dump).not.toContain(MEANING);
    });

    it('is not enabled when the classification gate blocks the Commission', async () => {
      const version = submittedVersion({
        tenant: 'tsc',
        document: declaration([statement('officer', { assets: [land] })]),
      });
      api.declarations.given(version);
      api.ai.blockEverything('policy');

      const created = await processedFromInbox(api, version);
      await untilStatus(created.id, 'not-enabled');

      // A Commission without synthetic data is announced as highly confidential.
      expect(api.ai.calls[0]?.request.dataClass).toBe('highly-confidential');
      // The prompt version asked for is pinned, as its idempotency key names it.
      expect(api.ai.calls[0]?.request.promptVersion).toBe(1);
      const body = await view(created.id, tscReviewer);
      expect(body).toMatchObject({
        status: 'not-enabled',
        failureReason: 'policy',
        summary: null,
        explanations: null,
      });

      // A refresh asks the gateway again, which still blocks the Commission.
      await assign(created.id, 'reviewer-t');
      const calls = api.ai.calls.length;
      const refresh = await api.send('POST', refreshPath(created.id), tscReviewer);
      expect(refresh.statusCode).toBe(202);
      expect(refresh.json()).toMatchObject({ status: 'not-enabled' });
      expect(api.ai.calls.length).toBeGreaterThan(calls);

      // Once the gateway admits the Commission, a refresh requests the copilot anew.
      api.ai.reset();
      const enabled = await api.send('POST', refreshPath(created.id), tscReviewer);
      expect(enabled.statusCode).toBe(202);
      expect(enabled.json()).toMatchObject({ status: 'pending' });
    });

    it('a gate rule that now admits the Commission requests its not-enabled copilots again', async () => {
      const version = submittedVersion({
        tenant: 'tsc',
        document: declaration([statement('officer', { assets: [land] })]),
      });
      api.declarations.given(version);
      api.ai.blockEverything('policy');
      const created = await processedFromInbox(api, version);
      await untilStatus(created.id, 'not-enabled');
      api.ai.reset();

      const policyEvent = (tenant: string, allowed: boolean): EventEnvelope => ({
        specversion: '1.0',
        id: randomUUID(),
        source: 'adili/ai-gateway',
        type: 'ai.policy.changed.v1',
        time: new Date().toISOString(),
        subject: randomUUID(),
        datacontenttype: 'application/json',
        tenant,
        data: {
          action: 'ai.gate-policy.changed',
          tenant,
          actor: 'platform-admin-1',
          approvalRef: 'DPO-2028-01',
          before: {
            dataClass: 'highly-confidential',
            providerClass: 'self-hosted',
            allowed: !allowed,
          },
          after: { dataClass: 'highly-confidential', providerClass: 'self-hosted', allowed },
        },
      });
      // A rule that blocks, or another Commission's rule, asks nothing.
      await api.aiPolicy.changed(policyEvent('tsc', false));
      await api.aiPolicy.changed(policyEvent('psc', true));
      expect(api.ai.calls).toEqual([]);

      await api.aiPolicy.changed(policyEvent('tsc', true));
      await untilStatus(created.id, 'pending');
      expect(api.ai.jobsOf('summarize-declaration')).toHaveLength(1);
    });

    it('is not enabled when a blocked job is announced by event, and failed when a job fails', async () => {
      const { first } = versions();
      api.declarations.given(first);

      const { caseId, row } = await createdCase(first);
      await deliver(api.ai.block(row.requestedSummaryJobId ?? ''));
      await untilStatus(caseId, 'not-enabled');

      // Reset the row to a fresh request.
      await api.asPlatform((tx) =>
        tx
          .update(reviewCopilots)
          .set({ status: 'pending' })
          .where(eq(reviewCopilots.caseId, caseId)),
      );
      await deliver(api.ai.fail(row.requestedExplanationsJobId ?? '', 'validation'));
      const failed = await untilStatus(caseId, 'failed');
      expect(failed.failureReason).toBe('validation');
      expect((await view(caseId)).failureReason).toBe('validation');
    });

    it('ignores the events of an earlier request and of jobs about anything else', async () => {
      const { first } = versions();
      api.declarations.given(first);
      const { caseId, row } = await createdCase(first);
      await assign(caseId, 'reviewer-a');
      await deliver(api.ai.fail(row.requestedSummaryJobId ?? ''));
      await untilStatus(caseId, 'failed');

      const refresh = await api.send('POST', refreshPath(caseId), reviewerA);
      expect(refresh.statusCode).toBe(202);
      const second = await copilotRow(caseId);
      expect(second?.status).toBe('pending');
      expect(second?.requestedSummaryJobId).not.toBe(row.requestedSummaryJobId);

      // The first request's other job ends: nothing changes.
      const earlier = api.ai.succeed(row.requestedExplanationsJobId ?? '', explanationsOutput([]));
      await deliver(earlier);
      // A job of another service's, for the same tenant.
      const foreign = {
        ...api.ai.eventOf(second?.requestedSummaryJobId ?? ''),
        id: randomUUID(),
        data: { jobId: randomUUID(), subjectRef: `declaration-draft:${randomUUID()}` },
      };
      await api.aiJobs.completed(foreign);

      await completeJobs(caseId);
      const ready = await copilotRow(caseId);
      expect(ready?.explanationsJobId).toBe(second?.requestedExplanationsJobId);
    });

    it('records a job that ended before the request was recorded (a cached result)', async () => {
      const { first } = versions();
      api.declarations.given(first);
      const { caseId, row } = await createdCase(first);
      await completeJobs(caseId);
      await assign(caseId, 'reviewer-a');

      // The refresh's jobs: the gateway answers them finished at once (its cache).
      const before = api.ai.created.length;
      const refreshed = api.ai.runTask.bind(api.ai);
      vi.spyOn(api.ai, 'runTask').mockImplementation(async (task, request, key) => {
        const job = await refreshed(task, request, key);
        const output =
          task === 'summarize-declaration'
            ? summaryOutput('Refreshed overview.')
            : explanationsOutput(await flagIdsOf(caseId));
        api.ai.succeed(job.id, output);
        return { ...job, status: 'succeeded', output, finishedAt: new Date().toISOString() };
      });

      const refresh = await api.send('POST', refreshPath(caseId), reviewerA);
      vi.restoreAllMocks();
      expect(refresh.statusCode).toBe(202);
      expect(api.ai.created.length).toBe(before + 2);
      expect(refresh.json<CopilotView>()).toMatchObject({
        status: 'ready',
        summary: { overview: 'Refreshed overview.' },
      });
      expect((await copilotRow(caseId))?.summaryJobId).not.toBe(row.requestedSummaryJobId);
    });
  });

  describe('S11: stale on amendment and re-check; refresh', () => {
    it('an amendment marks the copilot stale, keeps the earlier outputs and requests them again', async () => {
      const { first, second } = versions();
      api.declarations.given(first, second);
      const { caseId } = await createdCase(first);
      await completeJobs(caseId, 'Version 1 overview.');

      await processedFromInbox(api, second);
      const stale = await untilStatus(caseId, 'stale');
      expect(stale).toMatchObject({ forVersionId: second.versionId, attempt: 2 });

      const during = await view(caseId);
      expect(during).toMatchObject({
        status: 'stale',
        forVersionId: first.versionId,
        summary: { overview: 'Version 1 overview.' },
      });

      // The amendment's inputs hold the previous version and what changed.
      const amended = api.ai.calls.filter((call) => call.task === 'summarize-declaration').at(-1);
      expect(amended?.request.input).toMatchObject({
        document: second.document,
        previousDocument: first.document,
        changes: [{ kind: 'value-changed', personKey: 'officer', percent: 30 }],
      });

      await completeJobs(caseId, 'Version 2 overview.');
      expect(await view(caseId)).toMatchObject({
        status: 'ready',
        forVersionId: second.versionId,
        summary: { overview: 'Version 2 overview.' },
      });
      const statuses = (await eventsOf('review.copilot.updated.v1')).map(
        (event) => (event.data as { status: string }).status,
      );
      expect(statuses).toEqual(['pending', 'ready', 'stale', 'ready']);
    });

    it('a registry re-check marks the copilot stale and asks anew with the check time', async () => {
      const { first } = versions();
      api.declarations.given(first);
      const { caseId } = await createdCase(first);
      await completeJobs(caseId);
      const keys = api.ai.calls.map((call) => call.idempotencyKey);

      await api.copilot.requestCopilot({
        tenant: 'psc',
        caseId,
        trigger: 're-check',
        registryCheckedAt: '2028-02-01T10:00:00.000Z',
      });

      const stale = await copilotRow(caseId);
      expect(stale).toMatchObject({ status: 'stale', attempt: 2 });
      expect(stale?.registryCheckedAt?.toISOString()).toBe('2028-02-01T10:00:00.000Z');
      const newKeys = api.ai.calls.slice(keys.length).map((call) => call.idempotencyKey);
      expect(newKeys).toHaveLength(2);
      expect(newKeys.some((key) => keys.includes(key))).toBe(false);

      // The activity retried (its jobs still being produced): the same keys, so the same jobs.
      const jobs = api.ai.created.length;
      await api.copilot.requestCopilot({
        tenant: 'psc',
        caseId,
        trigger: 're-check',
        registryCheckedAt: '2028-02-01T10:00:00.000Z',
      });
      expect(api.ai.calls.slice(-2).map((call) => call.idempotencyKey)).toEqual(newKeys);
      expect(api.ai.created).toHaveLength(jobs);
      expect(await copilotRow(caseId)).toMatchObject({
        status: 'stale',
        attempt: 2,
        requestedSummaryJobId: stale?.requestedSummaryJobId,
        requestedExplanationsJobId: stale?.requestedExplanationsJobId,
      });
      const statuses = (await eventsOf('review.copilot.updated.v1')).map(
        (event) => (event.data as { status: string }).status,
      );
      expect(statuses).toEqual(['pending', 'ready', 'stale']);
    });

    it('refresh: the assignee and a supervisor may, another reviewer gets 403, others 404, pending 409', async () => {
      const { first } = versions();
      api.declarations.given(first);
      const { caseId } = await createdCase(first);
      await assign(caseId, 'reviewer-a');

      const whilePending = await api.send('POST', refreshPath(caseId), reviewerA);
      expect(whilePending.statusCode).toBe(409);
      expect(whilePending.json()).toMatchObject({ type: 'copilot-pending' });

      await completeJobs(caseId);
      const byOther = await api.send('POST', refreshPath(caseId), reviewerB);
      expect(byOther.statusCode).toBe(403);
      expect(byOther.json()).toMatchObject({ type: 'not-the-assignee' });
      for (const caller of [tscReviewer, commissionAdmin]) {
        expect((await api.send('POST', refreshPath(caseId), caller)).statusCode).toBe(404);
      }

      const byAssignee = await api.send('POST', refreshPath(caseId), reviewerA);
      expect(byAssignee.statusCode).toBe(202);
      expect(
        contractErrors(
          okResponse('/v1/review/cases/{caseId}/copilot/refresh', 'post', 202),
          byAssignee.json(),
        ),
      ).toEqual([]);
      expect(byAssignee.json()).toMatchObject({ status: 'stale', summary: { overview: OVERVIEW } });
      // The refresh read the declaration for the assignee.
      expect(api.declarations.reads.at(-1)).toMatchObject({ actingSubject: 'reviewer-a', caseId });

      await completeJobs(caseId);
      const bySupervisor = await api.send('POST', refreshPath(caseId), supervisor);
      expect(bySupervisor.statusCode).toBe(202);
      expect((await copilotRow(caseId))?.attempt).toBe(3);
    });

    it('refresh while pending pulls the jobs again, so a copilot whose job events were lost is not stuck', async () => {
      const { first } = versions();
      api.declarations.given(first);
      const { caseId, row } = await createdCase(first);
      await assign(caseId, 'reviewer-a');

      // The jobs end, but their events never reach the workflow (dead-lettered).
      api.ai.succeed(row.requestedSummaryJobId ?? '', summaryOutput());
      api.ai.succeed(
        row.requestedExplanationsJobId ?? '',
        explanationsOutput(await flagIdsOf(caseId)),
      );
      const jobs = api.ai.created.length;

      const refresh = await api.send('POST', refreshPath(caseId), reviewerA);
      expect(refresh.statusCode).toBe(202);
      expect(refresh.json<CopilotView>()).toMatchObject({
        status: 'ready',
        summary: { overview: OVERVIEW },
      });
      // The outputs were pulled, not asked for again.
      expect(api.ai.created).toHaveLength(jobs);
    });

    it('a job that succeeded without a valid output fails the copilot as validation, storing nothing', async () => {
      const { first } = versions();
      api.declarations.given(first);
      const { caseId, row } = await createdCase(first);

      await deliver(
        api.ai.succeed(row.requestedSummaryJobId ?? '', { label: label('summarize-declaration') }),
      );
      const failed = await untilStatus(caseId, 'failed');
      expect(failed).toMatchObject({ failureReason: 'validation', summaryCiphertext: null });

      // A job that succeeded with no output at all, the same.
      await api.asPlatform((tx) =>
        tx
          .update(reviewCopilots)
          .set({ status: 'pending', failureReason: null })
          .where(eq(reviewCopilots.caseId, caseId)),
      );
      await deliver(
        api.ai.succeed(
          row.requestedExplanationsJobId ?? '',
          null as unknown as Record<string, unknown>,
        ),
      );
      expect(await untilStatus(caseId, 'failed')).toMatchObject({
        failureReason: 'validation',
        explanationsCiphertext: null,
      });
    });

    it('outputs are shown together: a newer summary waits for its explanations while stale', async () => {
      const { first, second } = versions();
      api.declarations.given(first, second);
      const { caseId } = await createdCase(first);
      await completeJobs(caseId, 'Version 1 overview.');

      await processedFromInbox(api, second);
      const stale = await untilStatus(caseId, 'stale');
      await deliver(
        api.ai.succeed(stale.requestedSummaryJobId ?? '', summaryOutput('Version 2 overview.')),
      );
      await vi.waitFor(async () => {
        const row = await copilotRow(caseId);
        if (row?.stagedSummaryCiphertext == null) throw new Error('summary not staged yet');
      });
      // The summary shown is still version 1's, with version 1's explanations.
      expect(await view(caseId)).toMatchObject({
        status: 'stale',
        forVersionId: first.versionId,
        summary: { overview: 'Version 1 overview.' },
      });

      await completeJobs(caseId, 'Version 2 overview.');
      expect(await view(caseId)).toMatchObject({
        status: 'ready',
        forVersionId: second.versionId,
        summary: { overview: 'Version 2 overview.' },
        jobs: { summarize: stale.requestedSummaryJobId, explain: stale.requestedExplanationsJobId },
      });
      expect(await copilotRow(caseId)).toMatchObject({
        stagedSummaryCiphertext: null,
        stagedExplanationsCiphertext: null,
      });
    });

    it('refresh with the gateway unreachable is 503 and changes nothing', async () => {
      const { first } = versions();
      api.declarations.given(first);
      const { caseId } = await createdCase(first);
      await completeJobs(caseId);
      await assign(caseId, 'reviewer-a');
      const before = await copilotRow(caseId);

      api.ai.failCalls(1);
      const response = await api.send('POST', refreshPath(caseId), reviewerA);

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ type: 'ai-gateway-unavailable' });
      expect(await copilotRow(caseId)).toEqual(before);
    });
  });

  describe('copilot view authorisation', () => {
    it("any reviewer or supervisor of the case's Commission reads it; anyone else gets 404", async () => {
      const { first } = versions();
      api.declarations.given(first);
      const { caseId } = await createdCase(first);

      for (const caller of [reviewerA, reviewerB, supervisor]) {
        expect((await api.get(copilotPath(caseId), caller)).statusCode).toBe(200);
      }
      for (const caller of [tscReviewer, commissionAdmin]) {
        expect((await api.get(copilotPath(caseId), caller)).statusCode).toBe(404);
      }
      expect((await api.get(copilotPath(randomUUID()), reviewerA)).statusCode).toBe(404);
      expect((await api.get(copilotPath('not-a-case'), reviewerA)).statusCode).toBe(404);
    });

    it('reads as pending for a case whose copilot was never requested, which the assignee can request', async () => {
      const version = submittedVersion({
        tenant: 'psc',
        document: declaration([statement('officer', { assets: [land] })]),
      });
      api.declarations.given(version);
      // The case as an earlier release created it: no copilot.
      const { caseId } = await (async () => {
        const created = await processedFromInbox(api, version);
        await untilStatus(created.id, 'pending');
        await api.asPlatform((tx) =>
          tx.delete(reviewCopilots).where(eq(reviewCopilots.caseId, created.id)),
        );
        return { caseId: created.id };
      })();

      expect(await view(caseId)).toMatchObject({
        status: 'pending',
        forVersionId: version.versionId,
        jobs: { summarize: null, explain: null },
      });
      await assign(caseId, 'reviewer-a');
      expect((await api.send('POST', refreshPath(caseId), reviewerA)).statusCode).toBe(202);
      expect((await copilotRow(caseId))?.status).toBe('pending');
    });
  });

  describe('S13: feedback', () => {
    const feedbackPath = (jobId: string) => `/v1/review/copilot/outputs/${jobId}/feedback`;
    const notHelpful = { rating: 'not-helpful', reason: 'missed-something', note: 'No plot.' };
    const helpful = { rating: 'helpful', reason: null, note: null };

    /** A case assigned to reviewer A with its copilot ready; returns the case and its jobs. */
    const readyCase = async () => {
      const { first } = versions();
      api.declarations.given(first);
      const { caseId } = await createdCase(first);
      const row = await completeJobs(caseId);
      await assign(caseId, 'reviewer-a');
      return {
        caseId,
        summary: row.summaryJobId ?? '',
        explanations: row.explanationsJobId ?? '',
      };
    };

    it("the assignee's rating is forwarded to the gateway, shown back to them, and a repeat replaces it", async () => {
      const { caseId, summary, explanations } = await readyCase();

      const rated = await api.send('PUT', feedbackPath(summary), reviewerA, notHelpful);
      expect(rated.statusCode).toBe(200);
      expect(api.ai.feedback).toEqual([
        {
          jobId: summary,
          feedback: {
            reviewerSubject: 'reviewer-a',
            block: null,
            rating: 'not-helpful',
            reason: 'missed-something',
            note: 'No plot.',
          },
        },
      ]);
      expect((await view(caseId)).feedback).toEqual([
        { jobId: summary, block: null, rating: 'not-helpful' },
      ]);

      // Rated again: the gateway gets the new rating; one rating per output for the reviewer.
      expect((await api.send('PUT', feedbackPath(summary), reviewerA, helpful)).statusCode).toBe(
        200,
      );
      expect(
        (await api.send('PUT', feedbackPath(explanations), reviewerA, helpful)).statusCode,
      ).toBe(200);
      expect(api.ai.feedback.map((call) => [call.jobId, call.feedback.rating])).toEqual([
        [summary, 'not-helpful'],
        [summary, 'helpful'],
        [explanations, 'helpful'],
      ]);
      const mine = (await view(caseId)).feedback;
      expect(mine).toHaveLength(2);
      expect(mine).toEqual(
        expect.arrayContaining([
          { jobId: summary, block: null, rating: 'helpful' },
          { jobId: explanations, block: null, rating: 'helpful' },
        ]),
      );
      // The feedback in the view is the caller's own: others see none of it.
      expect((await view(caseId, reviewerB)).feedback).toEqual([]);
      expect((await view(caseId, supervisor)).feedback).toEqual([]);
      // The note stays with the gateway.
      const [stored] = await api
        .asPlatform((tx) =>
          tx.execute<{ row: string }>(sql`select t::text as row from review_copilot_ratings t`),
        )
        .then((result) => result.rows);
      expect(stored?.row).not.toContain('No plot');
    });

    it('rates each block on its own: a summary block, a flag explanation; a block the output lacks is 400', async () => {
      const { caseId, summary, explanations } = await readyCase();
      const [flagId] = await flagIdsOf(caseId);
      if (!flagId) throw new Error('no flag');

      const rate = (jobId: string, block: unknown, body: object = helpful) =>
        api.send('PUT', feedbackPath(jobId), reviewerA, { ...body, block });
      expect((await rate(summary, 'overview', notHelpful)).statusCode).toBe(200);
      expect((await rate(summary, 'sections')).statusCode).toBe(200);
      expect((await rate(explanations, `flag:${flagId}`)).statusCode).toBe(200);
      // Rated again: replaces that block's rating only.
      expect((await rate(summary, 'overview')).statusCode).toBe(200);

      expect(api.ai.feedback.map((call) => [call.jobId, call.feedback.block])).toEqual([
        [summary, 'overview'],
        [summary, 'sections'],
        [explanations, `flag:${flagId}`],
        [summary, 'overview'],
      ]);
      expect((await view(caseId)).feedback).toEqual(
        expect.arrayContaining([
          { jobId: summary, block: 'overview', rating: 'helpful' },
          { jobId: summary, block: 'sections', rating: 'helpful' },
          { jobId: explanations, block: `flag:${flagId}`, rating: 'helpful' },
        ]),
      );
      expect((await view(caseId)).feedback).toHaveLength(3);

      // A flag the explanations do not cover, a summary block on the explanations, a malformed one.
      for (const [jobId, block] of [
        [explanations, `flag:${randomUUID()}`],
        [explanations, 'overview'],
        [summary, `flag:${flagId}`],
        [summary, 'everything'],
      ] as const) {
        expect((await rate(jobId, block)).statusCode, block).toBe(400);
      }
      expect(api.ai.feedback).toHaveLength(4);
    });

    it('a supervisor and another reviewer get 403, other tenants and outsiders 404, nothing forwarded', async () => {
      const { summary } = await readyCase();

      for (const caller of [supervisor, reviewerB]) {
        const response = await api.send('PUT', feedbackPath(summary), caller, helpful);
        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({ type: 'not-the-assignee' });
      }
      for (const caller of [tscReviewer, commissionAdmin]) {
        expect((await api.send('PUT', feedbackPath(summary), caller, helpful)).statusCode).toBe(
          404,
        );
      }
      // A job that is no output shown on a case, and an id that is no job.
      for (const jobId of [randomUUID(), 'not-a-job']) {
        expect((await api.send('PUT', feedbackPath(jobId), reviewerA, helpful)).statusCode).toBe(
          404,
        );
      }
      expect(api.ai.feedback).toEqual([]);
    });

    it('an invalid rating is 400; the gateway unreachable is 503 and nothing is recorded', async () => {
      const { caseId, summary } = await readyCase();

      for (const body of [
        { rating: 'meh', reason: null, note: null },
        { rating: 'not-helpful', reason: 'boring', note: null },
        { rating: 'helpful', reason: null, note: 'x'.repeat(1001) },
        { rating: 'helpful' },
      ]) {
        expect((await api.send('PUT', feedbackPath(summary), reviewerA, body)).statusCode).toBe(
          400,
        );
      }

      api.ai.failCalls(1);
      const unavailable = await api.send('PUT', feedbackPath(summary), reviewerA, helpful);
      expect(unavailable.statusCode).toBe(503);
      expect(unavailable.json()).toMatchObject({ type: 'ai-gateway-unavailable' });
      expect((await view(caseId)).feedback).toEqual([]);
      expect(api.ai.feedback).toEqual([]);
    });
  });
});
