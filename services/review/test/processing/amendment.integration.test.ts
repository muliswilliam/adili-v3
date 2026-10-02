import { asc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outbox, reviewCases, reviewFlags, reviewTimeline } from '../../src/db/schema.js';
import { asset, declaration, income, revalued, statement } from '../fixtures/declarations.js';
import { processedFromInbox, processingInput, twoVersions } from '../support/cases.js';
import type { StoredVersion } from '../support/fake-declarations.js';
import { type ReviewApi, startReviewApi } from '../support/review-api.js';

/**
 * S6 at the inbox seam: `declaration.submitted.v1` for version 2 of a declaration whose case is
 * open runs `DeclarationProcessingWorkflow`'s amendment path. The flags are recomputed against
 * version 1, reviewed flags are kept with the `recomputed` marker, the assignee and receipt stay,
 * and the case records a timeline entry and `review.case.updated.v1`.
 */
describe('amendment re-processing', () => {
  let api: ReviewApi;

  beforeAll(async () => {
    api = await startReviewApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    api.directory.givenCommission('psc');
  });

  const land = asset({ description: 'Plot in Kisumu', value: { kesCents: 1_000_000_000 } });
  const foreignAccount = asset({
    type: 'bank-account',
    description: 'Savings account',
    value: { kesCents: 50_000_000 },
    location: { inKenya: false, country: 'US' },
  });
  const salary = income();

  /** Version 1 and its amendment, version 2: the land is up 30% and not marked as changed. */
  const versions = () =>
    twoVersions(
      {
        tenant: 'psc',
        submittedAt: '2027-12-15T09:30:00.000Z',
        document: declaration([
          statement('officer', { income: [salary], assets: [land, foreignAccount] }),
        ]),
      },
      {
        submittedAt: '2028-01-20T08:00:00.000Z',
        declarantName: 'James Otieno Ouma',
        document: declaration([
          statement('officer', {
            income: [revalued(salary, 480_000_000)],
            assets: [revalued(land, 1_300_000_000), revalued(foreignAccount, 50_000_000)],
          }),
        ]),
      },
    );

  const caseOf = async (declarationId: string) => {
    const [found] = await api.asPlatform((tx) =>
      tx.select().from(reviewCases).where(eq(reviewCases.declarationId, declarationId)),
    );
    return found;
  };

  const flagsOf = (caseId: string) =>
    api.asPlatform((tx) => tx.select().from(reviewFlags).where(eq(reviewFlags.caseId, caseId)));

  const processed = (version: StoredVersion) => processedFromInbox(api, version);

  it('S6: version 2 for an open case recomputes the flags, keeps reviewed ones marked, keeps the assignee, adds a timeline entry and review.case.updated.v1', async () => {
    const { first, second } = versions();
    api.declarations.given(first, second);

    const created = await processed(first);
    const caseId = created.id;
    const firstFlags = await flagsOf(caseId);
    expect(firstFlags.map((flag) => flag.ruleId).sort()).toEqual([
      'foreign-holdings',
      'no-previous-version',
    ]);
    const reviewed = firstFlags.find((flag) => flag.ruleId === 'no-previous-version');
    const unreviewed = firstFlags.find((flag) => flag.ruleId === 'foreign-holdings');

    // Reviewer A holds the case and has reviewed one flag (the assignment and flag slices'
    // endpoints do this; here the rows are arranged directly).
    await api.asPlatform(async (tx) => {
      await tx
        .update(reviewCases)
        .set({
          status: 'assigned',
          assignee: 'reviewer-a',
          assigneeName: 'Reviewer A',
          claimedAt: new Date('2028-01-02T08:00:00.000Z'),
          openFlags: 1,
        })
        .where(eq(reviewCases.id, caseId));
      await tx
        .update(reviewFlags)
        .set({
          reviewedAt: new Date('2028-01-03T08:00:00.000Z'),
          reviewedBy: 'reviewer-a',
          reviewNote: 'First filing on Adili; nothing to compare.',
        })
        .where(eq(reviewFlags.id, reviewed?.id ?? ''));
    });

    const updated = await processed(second);

    expect(updated).toMatchObject({
      id: caseId,
      currentVersionId: second.versionId,
      currentVersion: 2,
      status: 'assigned',
      assignee: 'reviewer-a',
      assigneeName: 'Reviewer A',
      declarantName: 'James Otieno Ouma',
      rosterRecordId: second.rosterRecordId,
      reportingEntityId: second.reportingEntityId,
      // value-change-25 medium (3) + change-flag-mismatch low (1) + foreign-holdings info (0).
      score: 4,
      band: 'medium',
      openFlags: 3,
    });
    // Receipt is version 1; an amendment never moves it or the window.
    expect(updated.receivedAt.toISOString()).toBe(created.receivedAt.toISOString());
    expect(updated.windowEndsAt.toISOString()).toBe(created.windowEndsAt.toISOString());
    expect(updated.claimedAt?.toISOString()).toBe('2028-01-02T08:00:00.000Z');

    const flags = await flagsOf(caseId);
    // The reviewed flag is kept, marked recomputed, with its note and its version.
    expect(flags.find((flag) => flag.id === reviewed?.id)).toMatchObject({
      ruleId: 'no-previous-version',
      versionId: first.versionId,
      reviewedBy: 'reviewer-a',
      reviewNote: 'First filing on Adili; nothing to compare.',
      recomputed: true,
    });
    // The unreviewed flag of version 1 is replaced by version 2's.
    expect(flags.some((flag) => flag.id === unreviewed?.id)).toBe(false);
    const fresh = flags.filter((flag) => flag.id !== reviewed?.id);
    expect(fresh.map((flag) => [flag.ruleId, flag.severity]).sort()).toEqual([
      ['change-flag-mismatch', 'low'],
      ['foreign-holdings', 'info'],
      ['value-change-25', 'medium'],
    ]);
    expect(
      fresh.every(
        (flag) => flag.versionId === second.versionId && !flag.recomputed && !flag.reviewedAt,
      ),
    ).toBe(true);
    expect(fresh.find((flag) => flag.ruleId === 'value-change-25')?.evidence).toMatchObject({
      changePercent: 30,
      direction: 'up',
    });

    // The rules compared version 2 with version 1, read as the system.
    expect(api.declarations.reads).toContainEqual({
      declarationId: first.declarationId,
      version: 1,
      tenant: 'psc',
      actingSubject: 'system:review',
      caseId: undefined,
    });

    const timeline = await api.asPlatform((tx) =>
      tx
        .select()
        .from(reviewTimeline)
        .where(eq(reviewTimeline.caseId, caseId))
        .orderBy(asc(reviewTimeline.at)),
    );
    // Each version's registries are checked after it is processed (spec 07b).
    expect(timeline).toMatchObject([
      { kind: 'case-created', ref: first.versionId },
      { kind: 'registry-checked', ref: first.versionId },
      { kind: 'version-processed', ref: second.versionId, actor: 'system:review' },
      { kind: 'registry-checked', ref: second.versionId },
    ]);
    expect(timeline[2]?.summary).toBe(
      'Version 2 processed: 3 flags raised, 1 reviewed flag kept as recomputed',
    );

    // S21: identifiers and states only.
    const events = await api.db.select().from(outbox).orderBy(asc(outbox.createdAt));
    // Each version's case event, its registry check, then its copilot requested (spec 07c):
    // pending, then stale.
    expect(events.map((event) => event.eventType)).toEqual([
      'review.case.created.v1',
      'review.registry.checked.v1',
      'review.copilot.updated.v1',
      'review.case.updated.v1',
      'review.registry.checked.v1',
      'review.copilot.updated.v1',
    ]);
    expect(events[3]?.envelope).toMatchObject({
      type: 'review.case.updated.v1',
      subject: caseId,
      tenant: 'psc',
      data: {
        caseId,
        declarationId: first.declarationId,
        versionId: second.versionId,
        band: 'medium',
      },
    });
    expect(Object.keys(events[3]?.envelope.data ?? {}).sort()).toEqual([
      'band',
      'caseId',
      'declarationId',
      'versionId',
    ]);
  });

  it('S6: an amendment after the due date of an on-time filing is not late: no late-filing flag', async () => {
    const { first, second } = versions();
    // Version 1 on time (due 2027-12-31); the amendment comes after the due date.
    const late = { ...second, late: true };
    api.declarations.given(first, late);
    const created = await processed(first);

    const updated = await processed(late);

    expect(updated.late).toBe(false);
    expect(updated.receivedAt.toISOString()).toBe(created.receivedAt.toISOString());
    const flags = await flagsOf(created.id);
    expect(flags.some((flag) => flag.ruleId === 'late-filing')).toBe(false);
  });

  it('S6: a repeated or out-of-order announcement changes nothing', async () => {
    const { first, second } = versions();
    api.declarations.given(first, second);
    const created = await processed(first);
    await processed(second);
    const flagsAfter = await flagsOf(created.id);

    // Version 2 announced again (a new event, so the inbox lets it through), then version 1.
    for (const version of [second, first]) {
      const input = processingInput(version);
      const facts = await api.activities.pullVersion(input);
      if (!facts) throw new Error('version not pulled');
      const outcome = await api.activities.upsertCase({ input, facts, flags: [] });
      expect(outcome).toEqual({ outcome: 'unchanged', caseId: created.id });
    }

    expect(await caseOf(first.declarationId)).toMatchObject({
      currentVersionId: second.versionId,
      currentVersion: 2,
    });
    expect((await flagsOf(created.id)).map((flag) => flag.id).sort()).toEqual(
      flagsAfter.map((flag) => flag.id).sort(),
    );
    const events = await api.db.select().from(outbox);
    // Each version's case event, registry check and copilot request; nothing since.
    expect(events).toHaveLength(6);
  });
});
