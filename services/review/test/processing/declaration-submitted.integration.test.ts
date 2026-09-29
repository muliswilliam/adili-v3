import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { inbox, outbox, reviewCases, reviewFlags, reviewTimeline } from '../../src/db/schema.js';
import { asset, declaration, income, statement } from '../fixtures/declarations.js';
import { submittedVersion } from '../support/fake-declarations.js';
import { type ReviewApi, startReviewApi, submittedEvent } from '../support/review-api.js';

/**
 * S5 at the inbox seam: `declaration.submitted.v1` reaches the consumer, which starts
 * `DeclarationProcessingWorkflow` on Temporal; the workflow pulls the version from the fake
 * declarations service and creates the review case. Redelivery creates nothing.
 */
describe('declaration.submitted.v1 consumer and processing', () => {
  let api: ReviewApi;

  beforeAll(async () => {
    api = await startReviewApi();
  });

  afterAll(async () => {
    await api.close();
  });

  beforeEach(async () => {
    await api.reset();
    api.directory.givenCommission('psc');
  });

  const firstDeclaration = () =>
    submittedVersion({
      tenant: 'psc',
      submittedAt: '2027-12-15T09:30:00.000Z',
      declarantName: 'James Otieno',
      personnelFileNumber: 'PSC/2019/0042',
      document: declaration([
        statement('officer', {
          income: [income()],
          assets: [asset({ type: 'bank-account', location: { inKenya: false, country: 'US' } })],
        }),
      ]),
    });

  const casesOf = (declarationId: string) =>
    api.asPlatform((tx) =>
      tx.select().from(reviewCases).where(eq(reviewCases.declarationId, declarationId)),
    );

  it('S5: version 1 becomes an unassigned case with flags, score, receipt, window and read model; review.case.created.v1', async () => {
    const version = firstDeclaration();
    api.declarations.given(version);

    await api.consumer.submitted(submittedEvent('psc', version));

    const [created] = await vi.waitFor(
      async () => {
        const rows = await casesOf(version.declarationId);
        expect(rows).toHaveLength(1);
        return rows;
      },
      { timeout: 45_000, interval: 250 },
    );
    expect(created).toMatchObject({
      tenant: 'psc',
      declarationId: version.declarationId,
      currentVersionId: version.versionId,
      currentVersion: 1,
      personId: version.personId,
      reference: version.reference,
      type: 'biennial',
      statementDate: '2027-11-01',
      cycleYear: 2027,
      status: 'unassigned',
      assignee: null,
      late: false,
      declarantName: 'James Otieno',
      personnelFileNumber: 'PSC/2019/0042',
      // First declaration: no-previous-version and foreign-holdings, both info.
      score: 0,
      band: 'low',
      openFlags: 2,
      openClarifications: 0,
    });
    expect(created?.receivedAt.toISOString()).toBe('2027-12-15T09:30:00.000Z');
    expect(created?.windowEndsAt.toISOString()).toBe('2028-06-15T09:30:00.000Z');

    const caseId = created?.id ?? '';
    const flags = await api.asPlatform((tx) =>
      tx.select().from(reviewFlags).where(eq(reviewFlags.caseId, caseId)),
    );
    expect(flags.map((flag) => [flag.ruleId, flag.severity]).sort()).toEqual([
      ['foreign-holdings', 'info'],
      ['no-previous-version', 'info'],
    ]);
    expect(flags.every((flag) => flag.versionId === version.versionId)).toBe(true);
    expect(flags.every((flag) => flag.reviewedAt === null && !flag.recomputed)).toBe(true);

    const timeline = await api.asPlatform((tx) =>
      tx.select().from(reviewTimeline).where(eq(reviewTimeline.caseId, caseId)),
    );
    expect(timeline).toMatchObject([
      { kind: 'case-created', ref: version.versionId, actor: 'system:review' },
    ]);

    // The previous-version lookup found none; the content was read as the system, per version.
    expect(api.declarations.reads).toContainEqual({
      declarationId: version.declarationId,
      version: 1,
      tenant: 'psc',
      actingSubject: 'system:review',
      caseId: undefined,
    });

    // S21: identifiers and states only.
    const events = await api.db.select().from(outbox).orderBy(asc(outbox.createdAt));
    expect(events.map((event) => event.eventType)).toEqual(['review.case.created.v1']);
    expect(events[0]?.envelope).toMatchObject({
      type: 'review.case.created.v1',
      source: 'adili/review',
      subject: caseId,
      tenant: 'psc',
      data: {
        caseId,
        declarationId: version.declarationId,
        versionId: version.versionId,
        band: 'low',
      },
    });
    expect(Object.keys(events[0]?.envelope.data ?? {}).sort()).toEqual([
      'band',
      'caseId',
      'declarationId',
      'versionId',
    ]);
  });

  it('S5: redelivery and a second announcement of the same version create nothing', async () => {
    const version = firstDeclaration();
    api.declarations.given(version);
    const event = submittedEvent('psc', version);

    await api.consumer.submitted(event);
    await vi.waitFor(
      async () => {
        expect(await casesOf(version.declarationId)).toHaveLength(1);
      },
      { timeout: 45_000, interval: 250 },
    );
    const readsAfterFirst = api.declarations.reads.length;

    // The same event again (RabbitMQ redelivery): the inbox skips it.
    await api.consumer.submitted(event);
    // Another event for the same version: its workflow has completed and is not run again.
    await api.consumer.submitted(submittedEvent('psc', version));

    // Give a wrongly started run time to pull.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(await casesOf(version.declarationId)).toHaveLength(1);
    expect(api.declarations.reads).toHaveLength(readsAfterFirst);
    const events = await api.db.select().from(outbox);
    expect(events).toHaveLength(1);
    const handled = await api.db.select().from(inbox);
    expect(handled.map((row) => row.eventId).sort()).toHaveLength(2);
  });

  it('case creation is idempotent by version: a repeated upsert is unchanged', async () => {
    const version = firstDeclaration();
    api.declarations.given(version);
    const input = {
      tenant: 'psc',
      declarationId: version.declarationId,
      versionId: version.versionId,
      version: 1,
    };
    const facts = await api.activities.pullVersion(input);
    if (!facts) throw new Error('version not pulled');
    const flags = await api.activities.runRules({ input, facts, previous: null });

    const first = await api.activities.upsertCase({ input, facts, flags });
    const second = await api.activities.upsertCase({ input, facts, flags });

    expect(first.outcome).toBe('created');
    expect(second).toEqual({ outcome: 'unchanged', caseId: first.caseId });
    expect(await casesOf(version.declarationId)).toHaveLength(1);
    const flagRows = await api.asPlatform((tx) =>
      tx.select().from(reviewFlags).where(eq(reviewFlags.caseId, first.caseId)),
    );
    expect(flagRows).toHaveLength(flags.length);
    expect(await api.db.select().from(outbox)).toHaveLength(1);

    // A later version of the case takes the amendment path (S6, amendment.integration.test.ts).
    const amended = await api.activities.upsertCase({
      input: { ...input, versionId: crypto.randomUUID(), version: 2 },
      facts,
      flags,
    });
    expect(amended).toEqual({ outcome: 'updated', caseId: first.caseId });
    expect(await api.db.select().from(outbox)).toHaveLength(2);
  });

  it('retries pulls while declarations is unavailable, then creates the case', async () => {
    const version = firstDeclaration();
    api.declarations.given(version);
    api.declarations.failReads(2);

    await api.consumer.submitted(submittedEvent('psc', version));

    await vi.waitFor(
      async () => {
        expect(await casesOf(version.declarationId)).toHaveLength(1);
      },
      { timeout: 45_000, interval: 250 },
    );
  });

  it('rejects an event without a tenant, and one for a version it cannot name', async () => {
    const version = firstDeclaration();
    await expect(
      api.consumer.submitted({ ...submittedEvent('psc', version), tenant: undefined }),
    ).rejects.toThrow();
    await expect(
      api.consumer.submitted({
        ...submittedEvent('psc', version),
        data: { declarationId: version.declarationId },
      }),
    ).rejects.toThrow();
    expect(await api.db.select().from(inbox)).toHaveLength(0);
  });
});
