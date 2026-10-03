import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { CaseListItem, CasePage, QueueSummary } from '../../src/cases/representation.js';
import { clarifications, reviewCases } from '../../src/db/schema.js';
import type { VersionFacts } from '../../src/processing/contract.js';
import type { Flag, Severity } from '../../src/rules/index.js';
import { declaration, statement } from '../fixtures/declarations.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { submittedVersion } from '../support/fake-declarations.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';

/** S7 (and the queue half of S18) at the HTTP seam. */
describe('review queue and summary', () => {
  let api: ReviewApi;

  const reviewer: Caller = { sub: 'reviewer-a', tenant: 'psc', roles: ['reviewer'] };
  const supervisor: Caller = { sub: 'supervisor-s', tenant: 'psc', roles: ['supervisor'] };
  const queuePath = '/v1/commissions/{slug}/review/queue';
  const searchPath = '/v1/commissions/{slug}/review/queue/search';
  const summaryPath = '/v1/commissions/{slug}/review/queue/summary';

  beforeAll(async () => {
    api = await startReviewApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    api.directory.givenCommission('psc');
    api.directory.givenCommission('tsc');
  });

  const flagOf = (severity: Severity): Flag => ({
    ruleId: 'value-change-25',
    severity,
    title: 'Value changed by 25% or more',
    indicator: 'An indicator',
    evidence: { changePercent: 30 },
    itemRefs: [],
  });

  interface CaseFixture {
    tenant?: string;
    severities?: Severity[];
    submittedAt: string;
    reference?: string;
    declarantName?: string;
    personnelFileNumber?: string;
    type?: VersionFacts['type'];
    statementDate?: string;
    late?: boolean;
  }

  /** A case as the processing workflow leaves it; returns its id. */
  async function givenCase(fixture: CaseFixture): Promise<string> {
    const tenant = fixture.tenant ?? 'psc';
    const version = submittedVersion({
      tenant,
      reference:
        fixture.reference ?? `DEC-${tenant.toUpperCase()}-2027-${randomUUID().slice(0, 7)}-1`,
      type: fixture.type ?? 'biennial',
      statementDate: fixture.statementDate ?? '2027-11-01',
      submittedAt: fixture.submittedAt,
      late: fixture.late ?? false,
      declarantName: fixture.declarantName ?? 'Achieng Otieno',
      personnelFileNumber:
        fixture.personnelFileNumber ?? `${tenant.toUpperCase()}/${randomUUID().slice(0, 6)}`,
      document: declaration([statement('officer')]),
    });
    api.declarations.given(version);
    const result = await api.activities.upsertCase({
      input: {
        tenant,
        declarationId: version.declarationId,
        versionId: version.versionId,
        version: 1,
      },
      facts: {
        personId: version.personId,
        reference: version.reference,
        type: version.type,
        statementDate: version.statementDate,
        submittedAt: version.submittedAt,
        late: version.late,
        dueDate: version.dueDate,
      },
      flags: (fixture.severities ?? []).map(flagOf),
    });
    return result.caseId;
  }

  const ids = (page: CasePage) => page.items.map((item) => item.id);

  async function queue(query = '', caller: Caller = reviewer): Promise<CasePage> {
    const response = await api.get(`/v1/commissions/psc/review/queue${query}`, caller);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<CasePage>();
    expect(contractErrors(okResponse(queuePath, 'get'), body)).toEqual([]);
    return body;
  }

  /** The queue for a search, its text in the body (`searchReviewQueue`). */
  async function search(
    body: Record<string, unknown>,
    caller: Caller = reviewer,
  ): Promise<CasePage> {
    const response = await api.send(
      'POST',
      '/v1/commissions/psc/review/queue/search',
      caller,
      body,
    );
    expect(response.statusCode, response.body).toBe(200);
    const page = response.json<CasePage>();
    expect(contractErrors(okResponse(searchPath, 'post'), page)).toEqual([]);
    return page;
  }

  it('S7: orders by score descending, then oldest first', async () => {
    const lowOld = await givenCase({ severities: ['low'], submittedAt: '2027-12-01T08:00:00Z' });
    const highNew = await givenCase({
      severities: ['high', 'medium'],
      submittedAt: '2027-12-20T08:00:00Z',
    });
    const mediumNew = await givenCase({
      severities: ['medium'],
      submittedAt: '2027-12-18T08:00:00Z',
    });
    const mediumOld = await givenCase({
      severities: ['medium'],
      submittedAt: '2027-12-02T08:00:00Z',
    });
    const none = await givenCase({ submittedAt: '2027-11-15T08:00:00Z' });

    const page = await queue();

    expect(ids(page)).toEqual([highNew, mediumOld, mediumNew, lowOld, none]);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toMatchObject({
      band: 'high',
      status: 'unassigned',
      assignee: null,
      openFlags: 2,
      clarification: { open: 0, status: null, dueAt: null },
      currentVersion: 1,
      cycleYear: 2027,
      receivedAt: '2027-12-20T08:00:00.000Z',
      windowEndsAt: '2028-06-20T08:00:00.000Z',
    } satisfies Partial<CaseListItem>);
  });

  it('S7: filters by status, band, type, cycle, assignee, late and open clarification', async () => {
    const mine = await givenCase({
      severities: ['high', 'high'],
      submittedAt: '2027-12-01T08:00:00Z',
    });
    const colleague = await givenCase({
      severities: ['medium'],
      submittedAt: '2027-12-02T08:00:00Z',
    });
    const late = await givenCase({
      severities: ['low'],
      submittedAt: '2028-01-05T08:00:00Z',
      late: true,
    });
    const initial = await givenCase({
      type: 'initial',
      statementDate: '2028-03-10',
      submittedAt: '2028-03-20T08:00:00Z',
    });
    await api.asPlatform(async (tx) => {
      await tx
        .update(reviewCases)
        .set({ status: 'assigned', assignee: 'reviewer-a', assigneeName: 'Reviewer A' })
        .where(eq(reviewCases.id, mine));
      await tx
        .update(reviewCases)
        .set({
          status: 'awaiting-clarification',
          assignee: 'reviewer-b',
          assigneeName: 'Reviewer B',
          openClarifications: 1,
        })
        .where(eq(reviewCases.id, colleague));
      await tx.insert(clarifications).values({
        id: randomUUID(),
        tenant: 'psc',
        caseId: colleague,
        personId: randomUUID(),
        reference: 'CLR-PSC-2028-0000001-3',
        status: 'issued',
        items: [],
        issuedAt: new Date('2028-01-10T08:00:00Z'),
        dueAt: new Date('2028-02-09T08:00:00Z'),
        createdBy: 'reviewer-b',
      });
    });

    expect(ids(await queue('?status=assigned'))).toEqual([mine]);
    expect(ids(await queue('?band=high'))).toEqual([mine]);
    expect(ids(await queue('?type=initial'))).toEqual([initial]);
    expect(ids(await queue('?cycle=2028'))).toEqual([initial]);
    expect(ids(await queue('?assignee=mine'))).toEqual([mine]);
    expect(ids(await queue('?assignee=unassigned'))).toEqual([late, initial]);
    expect(ids(await queue('?assignee=reviewer-b'))).toEqual([colleague]);
    expect(ids(await queue('?assignee=any'))).toHaveLength(4);
    expect(ids(await queue('?late=true'))).toEqual([late]);
    expect(ids(await queue('?late=false'))).not.toContain(late);
    expect(ids(await queue('?openClarification=true'))).toEqual([colleague]);
    expect(ids(await queue('?openClarification=false'))).toEqual([mine, late, initial]);

    const [withClarification] = (await queue('?openClarification=true')).items;
    expect(withClarification).toMatchObject({
      status: 'awaiting-clarification',
      assignee: { subject: 'reviewer-b', name: 'Reviewer B' },
      clarification: { open: 1, status: 'issued', dueAt: '2028-02-09T08:00:00.000Z' },
    });

    const invalid = await api.get('/v1/commissions/psc/review/queue?band=urgent', reviewer);
    expect(invalid.statusCode).toBe(400);
  });

  it('S7: searches by reference prefix, file number prefix or part of a name', async () => {
    const byReference = await givenCase({
      reference: 'DEC-PSC-2027-0004242-8',
      submittedAt: '2027-12-01T08:00:00Z',
    });
    const byFile = await givenCase({
      personnelFileNumber: 'PSC/2011/7781',
      submittedAt: '2027-12-02T08:00:00Z',
    });
    const byName = await givenCase({
      declarantName: 'Wanjiru Kamau',
      submittedAt: '2027-12-03T08:00:00Z',
    });

    expect(ids(await search({ search: 'dec-psc-2027-00042' }))).toEqual([byReference]);
    expect(ids(await search({ search: 'PSC/2011' }))).toEqual([byFile]);
    expect(ids(await search({ search: 'KAMAU' }))).toEqual([byName]);
    // Only beginnings of references and file numbers match.
    expect(ids(await search({ search: '0004242' }))).toEqual([]);
    // LIKE wildcards are taken literally.
    expect(ids(await search({ search: '%' }))).toEqual([]);
    expect(ids(await search({ search: ' ' }))).toHaveLength(3);
  });

  it('M10: search text goes in a POST body with the filters, never in the query string', async () => {
    const lateKamau = await givenCase({
      declarantName: 'Wanjiru Kamau',
      late: true,
      submittedAt: '2027-12-01T08:00:00Z',
    });
    await givenCase({ declarantName: 'Otieno Kamau', submittedAt: '2027-12-02T08:00:00Z' });
    await givenCase({
      declarantName: 'Achieng Wanjiru',
      late: true,
      submittedAt: '2027-12-03T08:00:00Z',
    });

    expect(ids(await search({ search: 'kamau', late: true, cycle: 2027, limit: 10 }))).toEqual([
      lateKamau,
    ]);
    // The list's query has no search: a name sent there is refused, not silently dropped, so a
    // stale caller never takes the whole queue for a match.
    const inUrl = await api.get('/v1/commissions/psc/review/queue?search=kamau', reviewer);
    expect(inUrl.statusCode).toBe(400);
    expect(inUrl.headers['content-type']).toContain('application/problem+json');
    const problem = inUrl.json<{ status: number; errors: { path: string; message: string }[] }>();
    expect(problem.status).toBe(400);
    expect(problem.errors.map(({ path }) => path)).toEqual(['search']);
    expect(problem.errors[0]?.message).toContain('searchReviewQueue');
    const invalid = await api.send('POST', '/v1/commissions/psc/review/queue/search', reviewer, {
      late: 'true',
    });
    expect(invalid.statusCode).toBe(400);
    // Outsiders get 404, as on the list.
    const outsider = await api.send(
      'POST',
      '/v1/commissions/psc/review/queue/search',
      { tenant: 'tsc', roles: ['reviewer'] },
      { search: 'kamau' },
    );
    expect(outsider.statusCode).toBe(404);
  });

  it('S7: pages with a cursor', async () => {
    const created: string[] = [];
    for (let day = 1; day <= 5; day += 1) {
      created.push(
        await givenCase({
          severities: ['medium'],
          submittedAt: `2027-12-0${String(day)}T08:00:00Z`,
        }),
      );
    }

    const first = await queue('?limit=2');
    expect(ids(first)).toEqual(created.slice(0, 2));
    const second = await queue(`?limit=2&cursor=${first.nextCursor ?? ''}`);
    expect(ids(second)).toEqual(created.slice(2, 4));
    const third = await queue(`?limit=2&cursor=${second.nextCursor ?? ''}`);
    expect(ids(third)).toEqual(created.slice(4));
    expect(third.nextCursor).toBeNull();

    const unknown = await api.get(
      '/v1/commissions/psc/review/queue?cursor=bm90LWEtY3Vyc29y',
      reviewer,
    );
    expect(unknown.statusCode).toBe(400);
  });

  it('S7: summary counts by status and band, and overdue clarifications', async () => {
    const assigned = await givenCase({
      severities: ['high', 'high'],
      submittedAt: '2027-12-01T08:00:00Z',
    });
    await givenCase({ severities: ['medium'], submittedAt: '2027-12-02T08:00:00Z' });
    await givenCase({ submittedAt: '2027-12-03T08:00:00Z' });
    await givenCase({
      tenant: 'tsc',
      severities: ['high', 'high'],
      submittedAt: '2027-12-03T08:00:00Z',
    });
    await api.asPlatform(async (tx) => {
      await tx
        .update(reviewCases)
        .set({ status: 'awaiting-clarification', assignee: 'reviewer-a' })
        .where(eq(reviewCases.id, assigned));
      await tx.insert(clarifications).values({
        id: randomUUID(),
        tenant: 'psc',
        caseId: assigned,
        personId: randomUUID(),
        reference: 'CLR-PSC-2028-0000002-1',
        status: 'overdue',
        items: [],
        issuedAt: new Date('2028-01-10T08:00:00Z'),
        dueAt: new Date('2028-02-09T08:00:00Z'),
        createdBy: 'reviewer-a',
      });
    });

    const response = await api.get('/v1/commissions/psc/review/queue/summary', supervisor);

    expect(response.statusCode).toBe(200);
    const summary = response.json<QueueSummary>();
    expect(contractErrors(okResponse(summaryPath, 'get'), summary)).toEqual([]);
    expect(summary.byStatus).toMatchObject({
      unassigned: 2,
      assigned: 0,
      'awaiting-clarification': 1,
      clarified: 0,
      'ready-for-determination': 0,
    });
    expect(summary.byBand).toEqual({ low: 1, medium: 1, high: 1 });
    expect(summary.byStatusAndBand.unassigned).toEqual({ low: 1, medium: 1, high: 0 });
    expect(summary.byStatusAndBand['awaiting-clarification']).toEqual({
      low: 0,
      medium: 0,
      high: 1,
    });
    expect(summary.byStatusAndBand.determined).toEqual({ low: 0, medium: 0, high: 0 });
    expect(summary.mine).toEqual({ low: 0, medium: 0, high: 0 });
    expect(summary.overdueClarifications).toBe(1);
  });

  it("S7: summary counts the caller's cases that are not determined", async () => {
    const held = await givenCase({
      severities: ['high', 'high'],
      submittedAt: '2027-12-01T08:00:00Z',
    });
    const done = await givenCase({ severities: ['medium'], submittedAt: '2027-12-02T08:00:00Z' });
    const others = await givenCase({ submittedAt: '2027-12-03T08:00:00Z' });
    await api.asPlatform(async (tx) => {
      await tx
        .update(reviewCases)
        .set({ status: 'assigned', assignee: 'reviewer-a' })
        .where(eq(reviewCases.id, held));
      await tx
        .update(reviewCases)
        .set({ status: 'determined', assignee: 'reviewer-a' })
        .where(eq(reviewCases.id, done));
      await tx
        .update(reviewCases)
        .set({ status: 'assigned', assignee: 'reviewer-b' })
        .where(eq(reviewCases.id, others));
    });

    const mine = await api.get('/v1/commissions/psc/review/queue/summary', reviewer);
    const theirs = await api.get('/v1/commissions/psc/review/queue/summary', supervisor);

    expect(mine.json<QueueSummary>().mine).toEqual({ low: 0, medium: 0, high: 1 });
    expect(theirs.json<QueueSummary>().mine).toEqual({ low: 0, medium: 0, high: 0 });
    expect(mine.json<QueueSummary>().byStatus).toMatchObject({ assigned: 2, determined: 1 });
  });

  it('S7/S18: a Commission sees its own cases; everyone else gets 404', async () => {
    const psc = await givenCase({ submittedAt: '2027-12-01T08:00:00Z' });
    await givenCase({ tenant: 'tsc', submittedAt: '2027-12-01T08:00:00Z' });

    expect(ids(await queue('', reviewer))).toEqual([psc]);
    expect(ids(await queue('', supervisor))).toEqual([psc]);

    const outsiders: [string, Caller][] = [
      ['tsc reviewer', { tenant: 'tsc', roles: ['reviewer'] }],
      ['tsc supervisor', { tenant: 'tsc', roles: ['supervisor'] }],
      ['declarant', { roles: ['declarant'], personId: randomUUID() }],
      ['helpdesk', { tenant: 'psc', roles: ['helpdesk'] }],
      ['commission-admin', { tenant: 'psc', roles: ['commission-admin'] }],
      ['reporting-officer', { tenant: 'psc', roles: ['reporting-officer'] }],
      ['platform-admin', { tenant: 'platform', roles: ['platform-admin'] }],
      ['eacc-analyst', { tenant: 'eacc', roles: ['eacc-analyst'] }],
    ];
    for (const [who, caller] of outsiders) {
      for (const path of [
        '/v1/commissions/psc/review/queue',
        '/v1/commissions/psc/review/queue/summary',
      ]) {
        const response = await api.get(path, caller);
        expect(response.statusCode, `${who} ${path}`).toBe(404);
      }
    }

    // A psc reviewer asking for tsc's queue, or for a slug that cannot be one.
    expect((await api.get('/v1/commissions/tsc/review/queue', reviewer)).statusCode).toBe(404);
    expect((await api.get('/v1/commissions/PSC!/review/queue', reviewer)).statusCode).toBe(404);
  });

  describe("the Commission's reviewers", () => {
    const reviewersPath = '/v1/commissions/psc/review/queue/reviewers';
    const hold = (caseId: string, assignee: string, status: CaseListItem['status']) =>
      api.asPlatform((tx) =>
        tx.update(reviewCases).set({ assignee, status }).where(eq(reviewCases.id, caseId)),
      );

    it('lists reviewers and supervisors from the directory by name, with the open cases they hold', async () => {
      api.directory.givenStaff('psc', 'reviewer', [
        { subject: 'reviewer-b', name: 'Wafula Barasa' },
        { subject: 'reviewer-a', name: 'Asha Njeri' },
        { subject: 'reviewer-new', name: 'Mercy Chebet' },
      ]);
      api.directory.givenStaff('psc', 'supervisor', [
        { subject: 'supervisor-s', name: 'Grace Akinyi' },
      ]);
      const cases = await Promise.all(
        ['2027-12-01', '2027-12-02', '2027-12-03', '2027-12-04'].map((day) =>
          givenCase({ submittedAt: `${day}T08:00:00Z` }),
        ),
      );
      await hold(cases[0] ?? '', 'reviewer-a', 'assigned');
      await hold(cases[1] ?? '', 'reviewer-a', 'awaiting-clarification');
      await hold(cases[2] ?? '', 'reviewer-a', 'determined');
      await hold(cases[3] ?? '', 'supervisor-s', 'ready-for-determination');
      const tscCase = await givenCase({ tenant: 'tsc', submittedAt: '2027-12-05T08:00:00Z' });
      await hold(tscCase, 'reviewer-b', 'assigned');

      const response = await api.get(reviewersPath, supervisor);

      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<unknown>();
      expect(
        contractErrors(okResponse('/v1/commissions/{slug}/review/queue/reviewers', 'get'), body),
      ).toEqual([]);
      expect(body).toEqual({
        items: [
          { subject: 'reviewer-a', name: 'Asha Njeri', supervisor: false, openCases: 2 },
          { subject: 'supervisor-s', name: 'Grace Akinyi', supervisor: true, openCases: 1 },
          // Never held a case: listed all the same (the queue alone would not name her).
          { subject: 'reviewer-new', name: 'Mercy Chebet', supervisor: false, openCases: 0 },
          { subject: 'reviewer-b', name: 'Wafula Barasa', supervisor: false, openCases: 0 },
        ],
      });
    });

    it('is for supervisors of the Commission: 403 for a reviewer, 404 for others; 502 without the directory', async () => {
      const reviewerResponse = await api.get(reviewersPath, reviewer);
      expect(reviewerResponse.statusCode).toBe(403);
      expect(reviewerResponse.json<{ type: string }>().type).toBe('supervisor-required');
      const tscSupervisor: Caller = { tenant: 'tsc', roles: ['supervisor'] };
      expect((await api.get(reviewersPath, tscSupervisor)).statusCode).toBe(404);

      api.directory.reset();
      const down = await api.get(reviewersPath, supervisor);
      expect(down.statusCode).toBe(502);
      expect(down.json<{ type: string }>().type).toBe('directory-unavailable');
    });
  });
});
