import { randomUUID } from 'node:crypto';

import { parse } from '@adili/numbering';
import { TEMPORAL_CLIENT } from '@adili/temporal';
import type { Client } from '@temporalio/client';
import { asc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clarifications,
  outbox,
  referrals,
  reviewCases,
  reviewTimeline,
} from '../../src/db/schema.js';
import { determinationIssuanceWorkflowId } from '../../src/determinations/contract.js';

import type {
  DeclarantDecisionView,
  DeterminationView,
} from '../../src/determinations/representation.js';
import { asset, declaration, statement } from '../fixtures/declarations.js';
import { givenAssignedCase } from '../support/cases.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { approve, givenWorkedCase, propose } from '../support/determinations.js';
import { submittedVersion } from '../support/fake-declarations.js';
import { givenLadder } from '../support/referrals.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';
import { historyPayloads } from '../support/workflow-history.js';

/**
 * S1 and S2 at the HTTP seam, with the authorisation matrix rows for determinations: the case's
 * assignee proposes; the separation-of-duties rule keeps the proposer, every reviewer of record and
 * any non-supervisor from approving or returning; an eligible supervisor's approval allocates the
 * CMP reference, moves the case to `determined` and starts DeterminationIssuanceWorkflow on
 * Temporal, which requests the decision letter from the fake documents service (pulling the
 * payload by determination id) and notifies the declarant by person.
 */
describe('determinations: propose, approve, return, withdraw', () => {
  let api: ReviewApi;

  const reviewerA: Caller = {
    sub: 'reviewer-a',
    tenant: 'psc',
    roles: ['reviewer'],
    name: 'Amina Wafula',
  };
  const reviewerB: Caller = { sub: 'reviewer-b', tenant: 'psc', roles: ['reviewer'] };
  /** A supervisor who once held the case: a reviewer of record. */
  const supervisorR: Caller = {
    sub: 'supervisor-r',
    tenant: 'psc',
    roles: ['supervisor'],
    name: 'Rose Kamau',
  };
  const supervisorS: Caller = {
    sub: 'supervisor-s',
    tenant: 'psc',
    roles: ['supervisor'],
    name: 'Samuel Njoroge',
  };
  const tscSupervisor: Caller = { sub: 'supervisor-t', tenant: 'tsc', roles: ['supervisor'] };
  const helpdesk: Caller = { sub: 'helpdesk-h', tenant: 'psc', roles: ['helpdesk'] };
  const documentsService: Caller = {
    sub: 'service-account-documents',
    scopes: ['review:internal'],
  };

  const version = submittedVersion({
    tenant: 'psc',
    declarantName: 'James Otieno',
    reference: 'DCB-PSC-2027-0000042-7',
    document: declaration([statement('officer', { assets: [asset({ description: 'Plot' })] })]),
  });
  const declarant: Caller = {
    sub: 'declarant-james',
    roles: ['declarant'],
    personId: version.personId,
  };
  const reasons = 'The declarant omitted the spouse vehicle acquired in 2026.';

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

  /** The case, held first by supervisor R, then by reviewer A who proposes. */
  async function proposed(): Promise<{ caseId: string; determination: DeterminationView }> {
    const caseId = await givenWorkedCase(api, version, [supervisorR, reviewerA]);
    const response = await propose(api, caseId, reviewerA);
    expect(response.statusCode, response.body).toBe(201);
    return { caseId, determination: response.json<DeterminationView>() };
  }

  const outboxOf = async (type: string) =>
    (await api.asPlatform((tx) => tx.select().from(outbox)))
      .filter((event) => event.envelope.type === type)
      .map((event) => event.envelope);

  it('S1: the assignee proposes non-compliant with reasons; proposed, with the event', async () => {
    const { caseId, determination } = await proposed();

    expect(
      contractErrors(
        okResponse('/v1/review/cases/{caseId}/determinations', 'post', 201),
        determination,
      ),
    ).toEqual([]);
    expect(determination).toMatchObject({
      caseId,
      outcome: 'non-compliant',
      reasons,
      proposerKind: 'user',
      proposer: { subject: 'reviewer-a', name: 'Amina Wafula' },
      proposedAt: '2027-12-20T08:00:00.000Z',
      status: 'proposed',
      approver: null,
      approvedAt: null,
      returnReason: null,
      furtherActionLink: null,
      reference: null,
      letterAvailable: false,
    });
    expect(await outboxOf('determination.proposed.v1')).toMatchObject([
      {
        subject: determination.id,
        tenant: 'psc',
        data: {
          determinationId: determination.id,
          caseId,
          outcome: 'non-compliant',
          proposerKind: 'user',
          approver: null,
        },
      },
    ]);

    const read = await api.get(`/v1/review/determinations/${determination.id}`, supervisorS);
    expect(read.statusCode).toBe(200);
    expect(
      contractErrors(okResponse('/v1/review/determinations/{determinationId}', 'get'), read.json()),
    ).toEqual([]);
  });

  it('S1: the proposer, another reviewer and a supervisor of record are refused (403)', async () => {
    const { determination } = await proposed();

    const byProposer = await approve(api, determination.id, reviewerA);
    expect(byProposer.statusCode, byProposer.body).toBe(403);
    expect(byProposer.json()).toMatchObject({
      type: 'separation-of-duties',
      code: 'separation-of-duties',
      reason: 'proposer',
    });

    const byReviewer = await approve(api, determination.id, reviewerB);
    expect(byReviewer.statusCode, byReviewer.body).toBe(403);
    expect(byReviewer.json()).toMatchObject({ code: 'supervisor-required', reason: 'role' });

    const byReviewerOfRecord = await approve(api, determination.id, supervisorR);
    expect(byReviewerOfRecord.statusCode, byReviewerOfRecord.body).toBe(403);
    expect(byReviewerOfRecord.json()).toMatchObject({
      code: 'separation-of-duties',
      reason: 'reviewer-of-record',
    });

    // Returning is decided by the same rule.
    const returnedByRecord = await api.send(
      'POST',
      `/v1/review/determinations/${determination.id}/return`,
      supervisorR,
      { reason: 'Reconsider.' },
    );
    expect(returnedByRecord.statusCode).toBe(403);
    expect(returnedByRecord.json()).toMatchObject({ code: 'separation-of-duties' });
    const returnedByReviewer = await api.send(
      'POST',
      `/v1/review/determinations/${determination.id}/return`,
      reviewerB,
      { reason: 'Reconsider.' },
    );
    expect(returnedByReviewer.statusCode).toBe(403);

    const unchanged = await api.get(`/v1/review/determinations/${determination.id}`, supervisorS);
    expect(unchanged.json<DeterminationView>().status).toBe('proposed');
    expect(await outboxOf('determination.approved.v1')).toEqual([]);
  });

  it('S1: another supervisor approves: CMP, letter, notification, case determined, events', async () => {
    const { caseId, determination } = await proposed();

    const response = await approve(api, determination.id, supervisorS);

    expect(response.statusCode, response.body).toBe(200);
    const approved = response.json<DeterminationView>();
    expect(
      contractErrors(
        okResponse('/v1/review/determinations/{determinationId}/approve', 'post'),
        approved,
      ),
    ).toEqual([]);
    expect(approved).toMatchObject({
      status: 'approved',
      approver: { subject: 'supervisor-s', name: 'Samuel Njoroge' },
      approvedAt: '2027-12-20T08:00:00.000Z',
    });
    expect(approved.reference).toMatch(/^CMP-PSC-2027-0000001-[0-9A-Z]$/);
    expect(parse(approved.reference ?? '')).toMatchObject({
      scheme: 'CMP',
      issuer: 'PSC',
      period: 2027,
      sequence: 1,
    });

    const [row] = await api.asPlatform((tx) =>
      tx.select().from(reviewCases).where(eq(reviewCases.id, caseId)),
    );
    expect(row?.status).toBe('determined');
    const timeline = await api.asPlatform((tx) =>
      tx
        .select()
        .from(reviewTimeline)
        .where(eq(reviewTimeline.caseId, caseId))
        .orderBy(asc(reviewTimeline.at), asc(reviewTimeline.id)),
    );
    expect(
      timeline
        .filter((entry) => entry.kind.startsWith('determination') || entry.ref === null)
        .map((entry) => [entry.kind, entry.actor])
        .slice(-3),
    ).toEqual([
      ['determination-proposed', 'reviewer-a'],
      ['determination-approved', 'supervisor-s'],
      ['status-changed', 'supervisor-s'],
    ]);

    expect(await outboxOf('determination.approved.v1')).toMatchObject([
      {
        subject: determination.id,
        tenant: 'psc',
        data: {
          determinationId: determination.id,
          caseId,
          outcome: 'non-compliant',
          proposerKind: 'user',
          approver: 'supervisor-s',
          reference: approved.reference,
        },
      },
    ]);
    const statusChanges = await outboxOf('review.case.status-changed.v1');
    expect(statusChanges.at(-1)).toMatchObject({
      subject: caseId,
      data: { caseId, from: 'assigned', to: 'determined' },
    });
    // S19: identifiers and outcomes only.
    for (const type of [
      'determination.proposed.v1',
      'determination.approved.v1',
      'review.case.status-changed.v1',
    ]) {
      for (const event of await outboxOf(type)) {
        expect(JSON.stringify(event.data)).not.toMatch(/Otieno|omitted|Wafula|Njoroge/);
      }
    }

    // DeterminationIssuanceWorkflow: the letter, pulled by determination id, then email and SMS.
    const letter = await vi.waitFor(
      () => {
        expect(api.documents.issued).toHaveLength(1);
        return api.documents.issued[0];
      },
      { timeout: 45_000, interval: 250 },
    );
    expect(letter?.request).toEqual({
      type: 'decision-letter',
      templateVersion: 1,
      subjectRef: `determination:${determination.id}`,
      subjectPersonId: version.personId,
      payload: { determinationId: determination.id },
    });
    expect(letter?.tenant).toBe('psc');
    expect(letter?.pulled.status).toBe(200);
    expect(
      contractErrors(
        okResponse('/internal/v1/review/determinations/{determinationId}/letter-payload', 'get'),
        letter?.pulled.body,
      ),
    ).toEqual([]);
    expect(letter?.pulled.body).toEqual({
      declarantName: 'James Otieno',
      commission: { name: 'Public Service Commission', issuerCode: 'PSC' },
      declarationReference: 'DCB-PSC-2027-0000042-7',
      determinationReference: approved.reference,
      outcome: 'non-compliant',
      outcomeLabel: 'Non-compliant',
      reasons,
      decidedAt: '2027-12-20T08:00:00.000Z',
      portalUrl: `http://localhost:3010/decisions/${determination.id}`,
    });

    await vi.waitFor(
      () => {
        expect(api.notifications.sent).toHaveLength(2);
      },
      { timeout: 45_000, interval: 250 },
    );
    const params = {
      commission: 'Public Service Commission',
      reference: approved.reference,
      outcome: 'Non-compliant',
      portalUrl: `http://localhost:3010/decisions/${determination.id}`,
    };
    expect(api.notifications.sent).toEqual([
      expect.objectContaining({
        channel: 'email',
        personId: version.personId,
        template: 'decision-email',
        tenant: 'psc',
        params,
      }),
      expect.objectContaining({
        channel: 'sms',
        personId: version.personId,
        template: 'decision-sms',
        tenant: 'psc',
        params,
      }),
    ]);

    // The letter is kept on the determination once documents answered.
    await vi.waitFor(
      async () => {
        const read = await api.get(`/v1/review/determinations/${determination.id}`, reviewerA);
        expect(read.json<DeterminationView>().letterAvailable).toBe(true);
      },
      { timeout: 45_000, interval: 250 },
    );

    // Temporal history carries identifiers only (07a rule).
    const temporal = api.app.get<Client>(TEMPORAL_CLIENT);
    const workflowId = determinationIssuanceWorkflowId(determination.id);
    await temporal.workflow.getHandle(workflowId).result();
    const history = await historyPayloads(temporal, workflowId);
    expect(history).toContain(determination.id);
    expect(history).not.toMatch(/Otieno|omitted|CMP-|Non-compliant|DCB-/);

    // Decided: approving again or returning is a 409.
    const again = await approve(api, determination.id, supervisorS);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'not-proposed' });
  });

  it('S1: further action keeps the case open as further-action; the next CMP follows', async () => {
    const { determination } = await proposed();
    await approve(api, determination.id, supervisorS);

    const other = submittedVersion({
      tenant: 'psc',
      document: declaration([statement('officer', {})]),
    });
    api.declarations.given(other);
    const otherCase = await givenWorkedCase(api, other, [reviewerA]);
    const { actionId } = await givenLadder(api, {
      tenant: 'psc',
      subjectKind: 'obligation',
      subjectId: randomUUID(),
      personId: other.personId,
      subjectReference: 'biennial:2027',
      startedAt: new Date('2027-12-01T08:00:00.000Z'),
      actionReference: 'ADM-PSC-2027-0000001-K',
    });
    const response = await propose(api, otherCase, reviewerA, {
      outcome: 'further-action',
      reasons: 'Refer the undeclared plot.',
      furtherActionNote: 'The notice to comply already issued covers it.',
      furtherActionLink: { kind: 'action', id: actionId },
    });
    expect(response.statusCode, response.body).toBe(201);
    const second = response.json<DeterminationView>();
    expect(second).toMatchObject({
      furtherActionNote: 'The notice to comply already issued covers it.',
      furtherActionLink: { kind: 'action', id: actionId },
    });

    const approved = (await approve(api, second.id, supervisorS)).json<DeterminationView>();

    expect(approved.reference).toMatch(/^CMP-PSC-2027-0000002-[0-9A-Z]$/);
    const read = await api.get(`/v1/review/determinations/${second.id}`, reviewerA);
    expect(
      contractErrors(okResponse('/v1/review/determinations/{determinationId}', 'get'), read.json()),
    ).toEqual([]);
    expect(read.json()).toMatchObject({ furtherActionLink: { kind: 'action', id: actionId } });
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(reviewCases).where(eq(reviewCases.id, otherCase)),
    );
    expect(row?.status).toBe('further-action');
  });

  it('S2: a supervisor returns with a reason; the reviewer revises with a new proposal', async () => {
    const { caseId, determination } = await proposed();

    const returned = await api.send(
      'POST',
      `/v1/review/determinations/${determination.id}/return`,
      supervisorS,
      { reason: 'Say which declaration the vehicle should have been in.' },
    );

    expect(returned.statusCode, returned.body).toBe(200);
    expect(
      contractErrors(
        okResponse('/v1/review/determinations/{determinationId}/return', 'post'),
        returned.json(),
      ),
    ).toEqual([]);
    expect(returned.json()).toMatchObject({
      status: 'returned',
      returnReason: 'Say which declaration the vehicle should have been in.',
      returnedBy: { subject: 'supervisor-s', name: 'Samuel Njoroge' },
      returnedAt: '2027-12-20T08:00:00.000Z',
      approver: null,
      reference: null,
    });
    expect(await outboxOf('determination.returned.v1')).toMatchObject([
      {
        subject: determination.id,
        data: { determinationId: determination.id, caseId, approver: 'supervisor-s' },
      },
    ]);
    const again = await api.send(
      'POST',
      `/v1/review/determinations/${determination.id}/return`,
      supervisorS,
      { reason: 'Twice.' },
    );
    expect(again.statusCode).toBe(409);

    const revised = await propose(api, caseId, reviewerA, {
      outcome: 'non-compliant',
      reasons: `${reasons} It belonged in the 2025 declaration.`,
    });
    expect(revised.statusCode, revised.body).toBe(201);
    const revision = revised.json<DeterminationView>();
    expect(revision.id).not.toBe(determination.id);
    expect(revision.status).toBe('proposed');

    // The case view shows both, the current one last.
    const view = await api.get(`/v1/review/cases/${caseId}`, reviewerA);
    expect(view.statusCode, view.body).toBe(200);
    expect(contractErrors(okResponse('/v1/review/cases/{caseId}', 'get'), view.json())).toEqual([]);
    expect(
      view
        .json<{ determinations: DeterminationView[] }>()
        .determinations.map((entry) => [entry.id, entry.status]),
    ).toEqual([
      [determination.id, 'returned'],
      [revision.id, 'proposed'],
    ]);
  });

  it('S2: the proposer withdraws while proposed; nobody else can', async () => {
    const { caseId, determination } = await proposed();
    const url = `/v1/review/determinations/${determination.id}/withdraw`;

    const byOther = await api.send('POST', url, supervisorS);
    expect(byOther.statusCode).toBe(403);
    expect(byOther.json()).toMatchObject({ type: 'not-the-proposer' });

    const withdrawn = await api.send('POST', url, reviewerA);
    expect(withdrawn.statusCode, withdrawn.body).toBe(200);
    expect(
      contractErrors(
        okResponse('/v1/review/determinations/{determinationId}/withdraw', 'post'),
        withdrawn.json(),
      ),
    ).toEqual([]);
    expect(withdrawn.json()).toMatchObject({ status: 'withdrawn' });
    expect(await outboxOf('determination.withdrawn.v1')).toMatchObject([
      { subject: determination.id, data: { determinationId: determination.id, caseId } },
    ]);

    const twice = await api.send('POST', url, reviewerA);
    expect(twice.statusCode).toBe(409);
    const approveWithdrawn = await approve(api, determination.id, supervisorS);
    expect(approveWithdrawn.statusCode).toBe(409);

    // The case takes a new proposal.
    expect((await propose(api, caseId, reviewerA)).statusCode).toBe(201);
  });

  describe('authorisation', () => {
    it('propose: the assignee only (403 for other staff); one open proposal per case', async () => {
      const caseId = await givenWorkedCase(api, version, [reviewerA]);

      const byOther = await propose(api, caseId, reviewerB);
      expect(byOther.statusCode).toBe(403);
      expect(byOther.json()).toMatchObject({ type: 'not-the-assignee' });
      const bySupervisor = await propose(api, caseId, supervisorS);
      expect(bySupervisor.statusCode).toBe(403);

      expect((await propose(api, caseId, reviewerA)).statusCode).toBe(201);
      const second = await propose(api, caseId, reviewerA);
      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({ code: 'determination-open' });
    });

    it('propose: not while a clarification of the case is open (409 clarification-open)', async () => {
      const caseId = await givenWorkedCase(api, version, [reviewerA]);
      const clarificationId = randomUUID();
      await api.asPlatform(async (tx) => {
        await tx.insert(clarifications).values({
          id: clarificationId,
          tenant: 'psc',
          caseId,
          personId: version.personId,
          reference: 'CLR-PSC-2027-0000001-K',
          status: 'issued',
          items: [],
          issuedAt: new Date('2027-12-01T08:00:00.000Z'),
          dueAt: new Date('2027-12-31T08:00:00.000Z'),
          createdBy: 'reviewer-a',
        });
        await tx
          .update(reviewCases)
          .set({ openClarifications: 1 })
          .where(eq(reviewCases.id, caseId));
      });

      const refused = await propose(api, caseId, reviewerA);
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({
        type: 'clarification-open',
        code: 'clarification-open',
      });
      expect(await outboxOf('determination.proposed.v1')).toEqual([]);

      // Resolved: the case takes a proposal.
      await api.asPlatform(async (tx) => {
        await tx
          .update(clarifications)
          .set({ status: 'resolved' })
          .where(eq(clarifications.id, clarificationId));
        await tx
          .update(reviewCases)
          .set({ openClarifications: 0 })
          .where(eq(reviewCases.id, caseId));
      });
      expect((await propose(api, caseId, reviewerA)).statusCode).toBe(201);
    });

    it('propose: a further-action link names an action or referral of the same declarant, on further action only (400 otherwise)', async () => {
      const caseId = await givenWorkedCase(api, version, [reviewerA]);
      const referralOf = async (personId: string) => {
        const id = randomUUID();
        await api.asPlatform((tx) =>
          tx.insert(referrals).values({
            id,
            tenant: 'psc',
            personId,
            caseId: null,
            cycleYear: 2027,
            grounds: 'two-missed-cycles',
            proposerKind: 'system',
            proposedAt: new Date('2027-12-01T08:00:00.000Z'),
            sources: {
              caseIds: [],
              flagIds: [],
              clarificationIds: [],
              obligationIds: [],
              actionIds: [],
            },
            narrative: 'Two biennial declarations unfiled.',
            status: 'proposed',
            declarantName: 'James Otieno',
            personnelFileNumber: 'PSC/0001',
          }),
        );
        return id;
      };
      const own = await referralOf(version.personId);
      const someoneElses = await referralOf(randomUUID());
      const furtherAction = (link: unknown, outcome = 'further-action') =>
        propose(api, caseId, reviewerA, { outcome, reasons, furtherActionLink: link });

      for (const [link, outcome] of [
        [{ kind: 'referral', id: own }, 'non-compliant'],
        [{ kind: 'referral', id: someoneElses }, 'further-action'],
        [{ kind: 'action', id: own }, 'further-action'],
        [{ kind: 'referral', id: randomUUID() }, 'further-action'],
        [{ kind: 'case', id: own }, 'further-action'],
      ] as const) {
        const refused = await furtherAction(link, outcome);
        expect(refused.statusCode, JSON.stringify(link)).toBe(400);
      }

      const linked = await furtherAction({ kind: 'referral', id: own });
      expect(linked.statusCode, linked.body).toBe(201);
      expect(linked.json()).toMatchObject({ furtherActionLink: { kind: 'referral', id: own } });
    });

    it('propose: a supervisor holding the case proposes, and cannot approve it', async () => {
      const caseId = await givenWorkedCase(api, version, [supervisorS]);
      const { id } = (await propose(api, caseId, supervisorS)).json<DeterminationView>();

      const own = await approve(api, id, supervisorS);
      expect(own.statusCode).toBe(403);
      expect(own.json()).toMatchObject({ code: 'separation-of-duties', reason: 'proposer' });
    });

    it('others: another Commission, declarants and helpdesk get 404', async () => {
      const { caseId, determination } = await proposed();

      for (const caller of [tscSupervisor, declarant, helpdesk]) {
        expect((await propose(api, caseId, caller)).statusCode).toBe(404);
        expect((await approve(api, determination.id, caller)).statusCode).toBe(404);
        expect(
          (
            await api.send('POST', `/v1/review/determinations/${determination.id}/return`, caller, {
              reason: 'No.',
            })
          ).statusCode,
        ).toBe(404);
        expect(
          (await api.send('POST', `/v1/review/determinations/${determination.id}/withdraw`, caller))
            .statusCode,
        ).toBe(404);
        expect(
          (await api.get(`/v1/review/determinations/${determination.id}`, caller)).statusCode,
        ).toBe(404);
      }
    });

    it('validation: an unknown outcome or empty reasons is a 400; approve needs a key', async () => {
      const caseId = await givenAssignedCase(api, version, 'reviewer-a');

      const outcome = await propose(api, caseId, reviewerA, {
        outcome: 'compliant-no-issues',
        reasons,
      });
      expect(outcome.statusCode).toBe(400);
      const empty = await propose(api, caseId, reviewerA, { outcome: 'compliant', reasons: ' ' });
      expect(empty.statusCode).toBe(400);

      const { id } = (await propose(api, caseId, reviewerA)).json<DeterminationView>();
      const noKey = await api.send('POST', `/v1/review/determinations/${id}/approve`, supervisorS);
      expect(noKey.statusCode).toBe(400);
    });
  });

  describe('declarant decisions and the letter payload', () => {
    it("the declarant sees their approved determinations only; nobody else's", async () => {
      const { determination } = await proposed();
      expect((await api.get('/v1/me/decisions', declarant)).json()).toEqual([]);

      const approved = (
        await approve(api, determination.id, supervisorS)
      ).json<DeterminationView>();

      const mine = await api.get('/v1/me/decisions', declarant);
      expect(mine.statusCode).toBe(200);
      expect(contractErrors(okResponse('/v1/me/decisions', 'get'), mine.json())).toEqual([]);
      expect(mine.json<DeclarantDecisionView[]>()).toEqual([
        {
          determinationId: determination.id,
          declarationReference: 'DCB-PSC-2027-0000042-7',
          commission: { slug: 'psc', name: 'Public Service Commission' },
          outcome: 'non-compliant',
          decidedAt: '2027-12-20T08:00:00.000Z',
          reference: approved.reference,
          letterAvailable: expect.any(Boolean) as boolean,
        },
      ]);

      const stranger: Caller = {
        sub: 'declarant-other',
        roles: ['declarant'],
        personId: '0190a1b2-0000-7000-8000-000000000001',
      };
      expect((await api.get('/v1/me/decisions', stranger)).json()).toEqual([]);
      expect((await api.get('/v1/me/decisions', supervisorS)).statusCode).toBe(404);
    });

    it('the letter payload: approved only, and only with a review:internal service token', async () => {
      const { determination } = await proposed();
      const url = `/internal/v1/review/determinations/${determination.id}/letter-payload`;
      const headers = { 'x-acting-tenant': 'psc' };

      expect((await api.get(url, documentsService, headers)).statusCode).toBe(404);
      await approve(api, determination.id, supervisorS);
      expect((await api.get(url, documentsService, headers)).statusCode).toBe(200);
      expect((await api.get(url, documentsService, { 'x-acting-tenant': 'tsc' })).statusCode).toBe(
        404,
      );
      expect((await api.get(url, supervisorS, headers)).statusCode).toBe(403);
    });
  });
});
