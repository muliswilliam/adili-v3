import { randomUUID } from 'node:crypto';

import { and, asc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { CaseListItem } from '../../src/cases/representation.js';
import {
  clarificationResponses,
  clarifications,
  outbox,
  reviewAssignments,
  reviewCases,
  reviewFlags,
  reviewTimeline,
} from '../../src/db/schema.js';
import { VIEW_DECLARATIONS_BUDGET_MS } from '../../src/internal-api/view-budget.js';
import type { Flag } from '../../src/rules/index.js';
import { asset, declaration, statement } from '../fixtures/declarations.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type StoredVersion, submittedVersion } from '../support/fake-declarations.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';

/** S8, S9, S11 and the case half of S18 at the HTTP seam. */
describe('review case: assignment, detail, notes and flags', () => {
  let api: ReviewApi;

  const reviewerA: Caller = {
    sub: 'reviewer-a',
    tenant: 'psc',
    roles: ['reviewer'],
    name: 'Achieng Wafula',
  };
  const reviewerB: Caller = {
    sub: 'reviewer-b',
    tenant: 'psc',
    roles: ['reviewer'],
    name: 'Brian Kiprop',
  };
  const supervisor: Caller = {
    sub: 'supervisor-s',
    tenant: 'psc',
    roles: ['supervisor'],
    name: 'Susan Njeri',
  };

  const casePath = '/v1/review/cases/{caseId}';
  const claimPath = '/v1/review/cases/{caseId}/claim';
  const releasePath = '/v1/review/cases/{caseId}/release';
  const assignmentPath = '/v1/review/cases/{caseId}/assignment';
  const notesPath = '/v1/review/cases/{caseId}/notes';
  const flagReviewedPath = '/v1/review/cases/{caseId}/flags/{flagId}/reviewed';
  const downloadPath = '/v1/review/cases/{caseId}/attachments/{uploadId}/download';

  // Content that must never reach the review database.
  const DESCRIPTION = 'Plot LR 209/8841 Karen Ridge';
  const VALUE_CENTS = 987_654_321;
  const UPLOAD_ID = randomUUID();

  beforeAll(async () => {
    api = await startReviewApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    api.directory.givenCommission('psc');
    api.directory.givenCommission('tsc');
  });

  const flags: Flag[] = [
    {
      ruleId: 'value-change-25',
      severity: 'medium',
      title: 'Value changed by 25% or more',
      indicator: 'An indicator',
      evidence: { changePercent: 41 },
      itemRefs: [],
    },
    {
      ruleId: 'foreign-holdings',
      severity: 'info',
      title: 'Holdings outside Kenya',
      indicator: 'An indicator',
      evidence: { count: 1 },
      itemRefs: [],
    },
  ];

  /** A submitted version held by the fake declarations service and its case; returns both. */
  async function givenCase(
    tenant = 'psc',
    raised: Flag[] = flags,
  ): Promise<{ caseId: string; version: StoredVersion }> {
    const version = submittedVersion({
      tenant,
      submittedAt: '2027-12-15T09:30:00.000Z',
      declarantName: 'James Otieno',
      personnelFileNumber: `${tenant.toUpperCase()}/2019/0042`,
      document: declaration([
        statement('officer', {
          assets: [
            asset({
              description: DESCRIPTION,
              value: { kesCents: VALUE_CENTS },
              attachments: [
                {
                  attachmentId: randomUUID(),
                  uploadId: UPLOAD_ID,
                  fileName: 'title-deed.pdf',
                  sha256: 'a'.repeat(64),
                },
              ],
            }),
          ],
        }),
      ]),
      attachments: [
        {
          uploadId: UPLOAD_ID,
          itemId: randomUUID(),
          personKey: 'officer',
          fileName: 'title-deed.pdf',
          sha256: 'a'.repeat(64),
        },
      ],
    });
    api.declarations.given(version);
    const { caseId } = await api.activities.upsertCase({
      input: {
        tenant,
        declarationId: version.declarationId,
        versionId: version.versionId,
        version: version.version,
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
      flags: raised,
    });
    // Processing read the version as the system; the tests count the reviewers' reads.
    api.declarations.reads.length = 0;
    return { caseId, version };
  }

  const at = (template: string, params: Record<string, string>) =>
    template.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '');

  const eventsOf = async (type: string) => {
    const rows = await api.asPlatform((tx) =>
      tx
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, type))
        .orderBy(asc(outbox.createdAt), asc(outbox.id)),
    );
    return rows.map((row) => row.envelope);
  };

  const caseRow = async (caseId: string) => {
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(reviewCases).where(eq(reviewCases.id, caseId)),
    );
    return row;
  };

  describe('S8: claim, release, reassign and unassign', () => {
    it('S8: A claims, B cannot claim or release, A releases, the supervisor reassigns to B and unassigns; each step is history, timeline and event', async () => {
      const { caseId } = await givenCase();
      const path = (template: string) => at(template, { caseId });

      const claimed = await api.send('POST', path(claimPath), reviewerA);
      expect(claimed.statusCode, claimed.body).toBe(200);
      expect(contractErrors(okResponse(claimPath, 'post'), claimed.json())).toEqual([]);
      expect(claimed.json<CaseListItem>()).toMatchObject({
        id: caseId,
        status: 'assigned',
        assignee: { subject: 'reviewer-a', name: 'Achieng Wafula' },
      });

      const conflict = await api.send('POST', path(claimPath), reviewerB);
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toMatchObject({ type: 'case-already-assigned', status: 409 });

      const notYours = await api.send('POST', path(releasePath), reviewerB);
      expect(notYours.statusCode).toBe(403);

      const reviewerReassigns = await api.send('PUT', path(assignmentPath), reviewerA, {
        assignee: 'reviewer-b',
      });
      expect(reviewerReassigns.statusCode).toBe(403);

      const released = await api.send('POST', path(releasePath), reviewerA);
      expect(released.statusCode, released.body).toBe(200);
      expect(contractErrors(okResponse(releasePath, 'post'), released.json())).toEqual([]);
      expect(released.json<CaseListItem>()).toMatchObject({ status: 'unassigned', assignee: null });

      const reassigned = await api.send('PUT', path(assignmentPath), supervisor, {
        assignee: 'reviewer-b',
      });
      expect(reassigned.statusCode, reassigned.body).toBe(200);
      expect(contractErrors(okResponse(assignmentPath, 'put'), reassigned.json())).toEqual([]);
      expect(reassigned.json<CaseListItem>()).toMatchObject({
        status: 'assigned',
        assignee: { subject: 'reviewer-b' },
      });

      const unassigned = await api.send('PUT', path(assignmentPath), supervisor, {
        assignee: null,
      });
      expect(unassigned.statusCode, unassigned.body).toBe(200);
      expect(unassigned.json<CaseListItem>()).toMatchObject({
        status: 'unassigned',
        assignee: null,
      });

      const history = await api.asPlatform((tx) =>
        tx
          .select()
          .from(reviewAssignments)
          .where(eq(reviewAssignments.caseId, caseId))
          .orderBy(asc(reviewAssignments.at), asc(reviewAssignments.id)),
      );
      expect(history.map((row) => [row.kind, row.subject, row.by])).toEqual([
        ['claimed', 'reviewer-a', 'reviewer-a'],
        ['released', null, 'reviewer-a'],
        ['reassigned', 'reviewer-b', 'supervisor-s'],
        ['unassigned', null, 'supervisor-s'],
      ]);

      const timeline = await api.asPlatform((tx) =>
        tx
          .select()
          .from(reviewTimeline)
          .where(and(eq(reviewTimeline.caseId, caseId), eq(reviewTimeline.kind, 'assigned'))),
      );
      expect(timeline).toHaveLength(4);
      // Every status move has its timeline entry, as for any other transition.
      const moves = await api.asPlatform((tx) =>
        tx
          .select()
          .from(reviewTimeline)
          .where(and(eq(reviewTimeline.caseId, caseId), eq(reviewTimeline.kind, 'status-changed')))
          .orderBy(asc(reviewTimeline.at), asc(reviewTimeline.id)),
      );
      expect(moves.map((entry) => [entry.summary, entry.actor])).toEqual([
        ['Status changed from unassigned to assigned', 'reviewer-a'],
        ['Status changed from assigned to unassigned', 'reviewer-a'],
        ['Status changed from unassigned to assigned', 'supervisor-s'],
        ['Status changed from assigned to unassigned', 'supervisor-s'],
      ]);

      const assigned = await eventsOf('review.case.assigned.v1');
      expect(assigned.map((event) => event.data)).toEqual([
        { caseId, assignee: 'reviewer-a', by: 'reviewer-a', kind: 'claimed' },
        { caseId, assignee: null, by: 'reviewer-a', kind: 'released' },
        { caseId, assignee: 'reviewer-b', by: 'supervisor-s', kind: 'reassigned' },
        { caseId, assignee: null, by: 'supervisor-s', kind: 'unassigned' },
      ]);
      expect(assigned.every((event) => event.tenant === 'psc')).toBe(true);
      const statusChanges = await eventsOf('review.case.status-changed.v1');
      expect(statusChanges.map((event) => event.data)).toEqual([
        { caseId, from: 'unassigned', to: 'assigned' },
        { caseId, from: 'assigned', to: 'unassigned' },
        { caseId, from: 'unassigned', to: 'assigned' },
        { caseId, from: 'assigned', to: 'unassigned' },
      ]);

      // The reviewer-of-record history spec 08 reads: A, then B.
      const detail = await api.get(path(casePath), supervisor);
      expect(detail.statusCode, detail.body).toBe(200);
      expect(
        detail
          .json<{ reviewerHistory: { subject: string }[] }>()
          .reviewerHistory.map((reviewer) => reviewer.subject),
      ).toEqual(['reviewer-a', 'reviewer-b']);
    });

    it('S8: a supervisor may claim; claiming an unknown case is 404; a bad body is 400', async () => {
      const { caseId } = await givenCase();
      const claimed = await api.send('POST', at(claimPath, { caseId }), supervisor);
      expect(claimed.statusCode).toBe(200);
      expect(claimed.json<CaseListItem>().assignee).toMatchObject({ subject: 'supervisor-s' });

      expect(
        (await api.send('POST', at(claimPath, { caseId: randomUUID() }), reviewerA)).statusCode,
      ).toBe(404);
      expect(
        (await api.send('POST', at(claimPath, { caseId: 'nope' }), reviewerA)).statusCode,
      ).toBe(404);
      expect(
        (await api.send('PUT', at(assignmentPath, { caseId }), supervisor, { assignee: 42 }))
          .statusCode,
      ).toBe(400);
    });
  });

  describe('S9: case detail pulled on demand', () => {
    it('S9: pulls the document from declarations on every view, audited with the viewer and case; stores no content; review.case.viewed.v1 per view', async () => {
      const { caseId, version } = await givenCase();
      await api.send('POST', at(claimPath, { caseId }), reviewerA);
      await api.send('POST', at(notesPath, { caseId }), reviewerA, { text: 'Checked the title' });

      // A clarification issued earlier, with its response, as #171 leaves them.
      const clarificationId = uuidv7();
      await api.asPlatform(async (tx) => {
        await tx.insert(clarifications).values({
          id: clarificationId,
          tenant: 'psc',
          caseId,
          personId: version.personId,
          reference: 'CLR-PSC-2028-0000001-3',
          status: 'responded',
          items: [
            {
              id: 'item-1',
              sectionKey: 'assets',
              personKey: 'officer',
              itemId: null,
              requirement: 'explain-discrepancy',
              text: 'Explain the change in value',
            },
          ],
          issuedAt: new Date('2028-01-10T08:00:00Z'),
          dueAt: new Date('2028-02-09T08:00:00Z'),
          respondedAt: new Date('2028-01-20T08:00:00Z'),
          responseLate: false,
          letterDocumentId: randomUUID(),
          letterVerificationId: 'V-123',
          createdBy: 'reviewer-a',
        });
        await tx.insert(clarificationResponses).values({
          clarificationId,
          tenant: 'psc',
          personId: version.personId,
          items: [{ itemId: 'item-1', text: 'Revalued by a surveyor' }],
          attachments: [
            { itemId: 'item-1', uploadId: randomUUID(), fileName: 'valuation.pdf', sha256: 'b' },
          ],
          submittedAt: new Date('2028-01-20T08:00:00Z'),
        });
      });

      for (const viewer of [reviewerA, supervisor]) {
        const response = await api.get(at(casePath, { caseId }), viewer);
        expect(response.statusCode, response.body).toBe(200);
        const body = response.json<Record<string, unknown>>();
        expect(contractErrors(okResponse(casePath, 'get'), body)).toEqual([]);
        expect(body).toMatchObject({
          case: { id: caseId, reference: version.reference, status: 'assigned' },
          document: version.document,
          versions: [
            {
              versionId: version.versionId,
              version: 1,
              submittedAt: version.submittedAt,
              late: false,
              amendment: false,
              firstOnAdili: false,
            },
          ],
          notes: [{ text: 'Checked the title', author: { subject: 'reviewer-a' } }],
          clarifications: [
            {
              id: clarificationId,
              reference: 'CLR-PSC-2028-0000001-3',
              status: 'responded',
              letter: { verificationId: 'V-123', status: 'issued' },
              response: {
                items: [{ index: 0, text: 'Revalued by a surveyor', attachments: [{}] }],
              },
            },
          ],
        });
        expect((body.flags as unknown[]).length).toBe(2);
        const kinds = (body.timeline as { kind: string }[]).map((entry) => entry.kind);
        expect(kinds).toEqual(expect.arrayContaining(['case-created', 'assigned', 'note-added']));
      }

      // Pulled on every view, naming the viewer and the case.
      expect(api.declarations.reads).toEqual([
        {
          declarationId: version.declarationId,
          version: 1,
          tenant: 'psc',
          actingSubject: 'reviewer-a',
          caseId,
        },
        {
          declarationId: version.declarationId,
          version: 1,
          tenant: 'psc',
          actingSubject: 'supervisor-s',
          caseId,
        },
      ]);

      const viewed = await eventsOf('review.case.viewed.v1');
      expect(viewed.map((event) => [event.tenant, event.data])).toEqual([
        ['psc', { caseId, subject: 'reviewer-a' }],
        ['psc', { caseId, subject: 'supervisor-s' }],
      ]);
      const audited = await eventsOf('audit.read.v1');
      expect(audited).toHaveLength(2);
      // #687: a case view reads the declarant's personal data, so it names them and why.
      expect(audited[0]?.data).toMatchObject({
        action: 'review.case.viewed',
        resource: {
          type: 'review-case',
          params: { caseId },
          tenant: 'psc',
          subjectPersonId: version.personId,
        },
        actor: { subject: 'reviewer-a' },
        legalBasis: { basis: 'review-case', reference: caseId },
      });

      // No declaration content anywhere in the review database.
      const dump = await api.asPlatform(async (tx) => {
        const tables = await tx.execute<{ table_name: string }>(
          sql`select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE'`,
        );
        const texts: string[] = [];
        for (const { table_name } of tables.rows) {
          const rows = await tx.execute<{ row: string }>(
            sql.raw(`select t::text as row from "${table_name}" t`),
          );
          texts.push(...rows.rows.map((row) => row.row));
        }
        return texts.join('\n');
      });
      expect(dump).toContain(caseId);
      expect(dump).not.toContain(DESCRIPTION);
      expect(dump).not.toContain(String(VALUE_CENTS));
      expect(dump).not.toContain('Ministry of Roads and Transport');
    });

    it('S9: declarations unavailable is 502 with the case metadata still returned, and no view recorded', async () => {
      const { caseId } = await givenCase();
      api.declarations.failReads(1);

      const response = await api.get(at(casePath, { caseId }), reviewerA);

      expect(response.statusCode).toBe(502);
      expect(response.headers['content-type']).toContain('application/problem+json');
      const body = response.json<Record<string, unknown>>();
      expect(body).toMatchObject({
        type: 'declarations-unavailable',
        title: 'Upstream service unavailable',
        status: 502,
        case: { id: caseId, status: 'unassigned' },
        document: null,
      });
      expect(
        contractErrors(
          okResponse(casePath, 'get', 502).replace(
            'application~1json',
            'application~1problem+json',
          ),
          body,
        ),
      ).toEqual([]);
      expect((body.flags as unknown[]).length).toBe(2);
      expect(body.versions).toHaveLength(1);
      expect(await eventsOf('review.case.viewed.v1')).toHaveLength(0);
    });

    it("S9: carries the declarant's preferred language, the letter's default (spec 07c FE-3); null when they chose none or the directory cannot say", async () => {
      const { caseId, version } = await givenCase();

      const unset = await api.get(at(casePath, { caseId }), reviewerA);
      expect(unset.statusCode, unset.body).toBe(200);
      expect(unset.json<Record<string, unknown>>().declarantLanguage).toBeNull();

      api.directory.givenPreferredLanguage(version.personId, 'sw');
      const chosen = await api.get(at(casePath, { caseId }), reviewerA);
      expect(chosen.statusCode, chosen.body).toBe(200);
      const body = chosen.json<Record<string, unknown>>();
      expect(contractErrors(okResponse(casePath, 'get'), body)).toEqual([]);
      expect(body.declarantLanguage).toBe('sw');

      // The directory being down never costs the reviewer the case.
      api.directory.failPreferredLanguageReads();
      const down = await api.get(at(casePath, { caseId }), reviewerA);
      expect(down.statusCode, down.body).toBe(200);
      expect(down.json<Record<string, unknown>>().declarantLanguage).toBeNull();
    });

    it('S9: a declarations service that hangs is 502 with the case within the view budget, before the console gives up', async () => {
      const { caseId } = await givenCase();
      api.declarations.stallReads(1);

      const started = performance.now();
      const response = await api.get(at(casePath, { caseId }), reviewerA);
      const elapsed = performance.now() - started;

      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({
        type: 'declarations-unavailable',
        case: { id: caseId },
        document: null,
      });
      expect(elapsed).toBeGreaterThanOrEqual(VIEW_DECLARATIONS_BUDGET_MS - 50);
      expect(elapsed).toBeLessThan(VIEW_DECLARATIONS_BUDGET_MS + 2_000);
    });

    it('S9: lists every version the case processed and pulls only the current one', async () => {
      // A first declaration on Adili: the rules found nothing to compare it with.
      const { caseId, version } = await givenCase('psc', [
        ...flags,
        {
          ruleId: 'no-previous-version',
          severity: 'info',
          title: 'First declaration on Adili',
          indicator: 'An indicator',
          evidence: {},
          itemRefs: [],
        },
      ]);
      const amended: StoredVersion = {
        ...version,
        versionId: randomUUID(),
        version: 2,
        submittedAt: '2028-01-20T10:00:00.000Z',
        late: true,
      };
      api.declarations.given(amended);
      const { outcome } = await api.activities.upsertCase({
        input: {
          tenant: 'psc',
          declarationId: amended.declarationId,
          versionId: amended.versionId,
          version: 2,
        },
        facts: {
          personId: amended.personId,
          reference: amended.reference,
          type: amended.type,
          statementDate: amended.statementDate,
          submittedAt: amended.submittedAt,
          late: amended.late,
          dueDate: amended.dueDate,
        },
        flags: [],
      });
      expect(outcome).toBe('updated');
      api.declarations.reads.length = 0;

      const response = await api.get(at(casePath, { caseId }), reviewerA);

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({
        versions: [
          // Version 1 stays a first declaration on Adili though the amendment replaced its flags.
          {
            versionId: version.versionId,
            version: 1,
            late: false,
            amendment: false,
            firstOnAdili: true,
          },
          {
            versionId: amended.versionId,
            version: 2,
            submittedAt: '2028-01-20T10:00:00.000Z',
            late: true,
            amendment: true,
            firstOnAdili: false,
          },
        ],
      });
      expect(api.declarations.reads.map((read) => read.version)).toEqual([2]);
    });

    it('S9: attachment links are resolved lazily through documents, only for the declaration under review', async () => {
      const { caseId, version } = await givenCase();
      api.documents.givenUploads('psc', UPLOAD_ID);
      const other = randomUUID();
      api.documents.givenUploads('psc', other);

      const response = await api.get(at(downloadPath, { caseId, uploadId: UPLOAD_ID }), reviewerA);
      expect(response.statusCode, response.body).toBe(200);
      expect(contractErrors(okResponse(downloadPath, 'get'), response.json())).toEqual([]);
      expect(response.json()).toMatchObject({
        downloadUrl: expect.stringContaining(UPLOAD_ID) as unknown,
      });
      // M13: read for the reviewer, whom documents' audit names (ADR-013 §8.6).
      expect(api.documents.downloads).toEqual([
        { uploadId: UPLOAD_ID, tenant: 'psc', actingSubject: reviewerA.sub },
      ]);
      expect(api.declarations.reads).toEqual([
        expect.objectContaining({
          declarationId: version.declarationId,
          actingSubject: 'reviewer-a',
          caseId,
        }),
      ]);
      const audited = await eventsOf('audit.read.v1');
      expect(audited.map((event) => (event.data as { action: string }).action)).toEqual([
        'review.case.attachment.downloaded',
      ]);

      // An upload of the Commission that is not an attachment of this declaration.
      const foreign = await api.get(at(downloadPath, { caseId, uploadId: other }), reviewerA);
      expect(foreign.statusCode).toBe(404);
      expect(api.documents.downloads).toHaveLength(1);
    });
  });

  describe('notes', () => {
    it('adds an internal note with a timeline entry that does not quote it', async () => {
      const { caseId } = await givenCase();
      const response = await api.send('POST', at(notesPath, { caseId }), reviewerB, {
        text: 'Asked HR for the payslip',
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(contractErrors(okResponse(notesPath, 'post', 201), response.json())).toEqual([]);
      expect(response.json()).toMatchObject({
        text: 'Asked HR for the payslip',
        author: { subject: 'reviewer-b', name: 'Brian Kiprop' },
      });
      const [entry] = await api.asPlatform((tx) =>
        tx
          .select()
          .from(reviewTimeline)
          .where(and(eq(reviewTimeline.caseId, caseId), eq(reviewTimeline.kind, 'note-added'))),
      );
      expect(entry?.summary).not.toContain('payslip');

      for (const text of ['', 'x'.repeat(2001)]) {
        expect(
          (await api.send('POST', at(notesPath, { caseId }), reviewerB, { text })).statusCode,
        ).toBe(400);
      }
    });
  });

  describe('S11: flag reviewed', () => {
    it('S11: marks a flag reviewed with a note; event; open-flag count decreases; once only', async () => {
      const { caseId } = await givenCase();
      const [flag] = await api.asPlatform((tx) =>
        tx.select().from(reviewFlags).where(eq(reviewFlags.caseId, caseId)),
      );
      const flagId = flag?.id ?? '';
      expect((await caseRow(caseId))?.openFlags).toBe(2);

      const response = await api.send('POST', at(flagReviewedPath, { caseId, flagId }), reviewerA, {
        note: 'Revaluation explained by the survey',
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(contractErrors(okResponse(flagReviewedPath, 'post'), response.json())).toEqual([]);
      const reviewed = response.json<{
        reviewed: { at: string; by: { subject: string }; note: string };
      }>().reviewed;
      expect(reviewed).toMatchObject({
        by: { subject: 'reviewer-a', name: 'Achieng Wafula' },
        note: 'Revaluation explained by the survey',
      });
      expect(Number.isNaN(Date.parse(reviewed.at))).toBe(false);

      const [row] = await api.asPlatform((tx) =>
        tx.select().from(reviewFlags).where(eq(reviewFlags.id, flagId)),
      );
      expect(row).toMatchObject({ reviewedBy: 'reviewer-a' });
      expect(row?.reviewedAt).toBeInstanceOf(Date);
      expect((await caseRow(caseId))?.openFlags).toBe(1);

      const events = await eventsOf('review.flag.reviewed.v1');
      expect(events.map((event) => [event.tenant, event.data])).toEqual([
        ['psc', { caseId, flagId, by: 'reviewer-a' }],
      ]);
      const timeline = await api.asPlatform((tx) =>
        tx
          .select()
          .from(reviewTimeline)
          .where(and(eq(reviewTimeline.caseId, caseId), eq(reviewTimeline.kind, 'flag-reviewed'))),
      );
      expect(timeline.map((entry) => entry.ref)).toEqual([flagId]);

      const again = await api.send('POST', at(flagReviewedPath, { caseId, flagId }), reviewerB, {
        note: 'Again',
      });
      expect(again.statusCode).toBe(409);
      expect((await caseRow(caseId))?.openFlags).toBe(1);

      expect(
        (
          await api.send(
            'POST',
            at(flagReviewedPath, { caseId, flagId: randomUUID() }),
            reviewerA,
            {
              note: 'x',
            },
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (await api.send('POST', at(flagReviewedPath, { caseId, flagId }), reviewerA, { note: '' }))
          .statusCode,
      ).toBe(400);
    });
  });

  describe('S18: authorisation matrix', () => {
    it("S18: only the Commission's reviewers and supervisors reach a case; everyone else gets 404", async () => {
      const { caseId } = await givenCase();
      const [flag] = await api.asPlatform((tx) =>
        tx.select().from(reviewFlags).where(eq(reviewFlags.caseId, caseId)),
      );
      api.documents.givenUploads('psc', UPLOAD_ID);
      const tscCase = await givenCase('tsc');

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
      const params = { caseId, flagId: flag?.id ?? '', uploadId: UPLOAD_ID };
      for (const [who, caller] of outsiders) {
        const calls: [string, ReturnType<ReviewApi['get']>][] = [
          ['detail', api.get(at(casePath, params), caller)],
          ['download', api.get(at(downloadPath, params), caller)],
          ['claim', api.send('POST', at(claimPath, params), caller)],
          ['release', api.send('POST', at(releasePath, params), caller)],
          ['assignment', api.send('PUT', at(assignmentPath, params), caller, { assignee: null })],
          ['note', api.send('POST', at(notesPath, params), caller, { text: 'note' })],
          ['flag', api.send('POST', at(flagReviewedPath, params), caller, { note: 'note' })],
        ];
        for (const [operation, call] of calls) {
          expect((await call).statusCode, `${who} ${operation}`).toBe(404);
        }
      }

      // A psc reviewer on a tsc case.
      expect((await api.get(at(casePath, { caseId: tscCase.caseId }), reviewerA)).statusCode).toBe(
        404,
      );
      // Nobody outside the Commission caused a read of the declaration.
      expect(api.declarations.reads).toEqual([]);
      expect(api.documents.downloads).toEqual([]);
      expect((await caseRow(caseId))?.status).toBe('unassigned');
    });
  });
});
