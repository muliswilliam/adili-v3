import { randomUUID } from 'node:crypto';

import { parse } from '@adili/numbering';
import { TEMPORAL_CLIENT } from '@adili/temporal';
import type { Client } from '@temporalio/client';
import { asc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { clarifications, ladderHistory, outbox } from '../../src/db/schema.js';
import { enforcementWorkflowId } from '../../src/enforcement/contract.js';

import type {
  ActionView,
  DeclarantNoticeView,
  LadderView,
} from '../../src/enforcement/representation.js';
import { asset, declaration, statement } from '../fixtures/declarations.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { givenWorkedCase } from '../support/determinations.js';
import {
  approveAction,
  clarificationEvent,
  declineAction,
  ladderOf,
  ladderWhen,
  obligationStatusChangedEvent,
} from '../support/enforcement.js';
import {
  overdueObligation,
  type StoredObligation,
  submittedVersion,
} from '../support/fake-declarations.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';
import { historyPayloads } from '../support/workflow-history.js';

/**
 * The enforcement ladder (spec 08 S5, S7, S8, S9, S11 as far as they do not need the salary
 * stoppage, #209) at the inbox and HTTP seams, with `EnforcementWorkflow` on Temporal: an overdue
 * obligation or an unanswered clarification starts a ladder whose notice to comply the system
 * drafts; a reviewer or supervisor who is not a reviewer of record approves it (`ADM` allocated,
 * Restricted letter from the fake documents service, the declarant told by person) or declines
 * it (the ladder ends; a supervisor restarts it); the warning follows the notice's window; the
 * declarant answers; filing or answering the clarification ends the ladder.
 *
 * The service clock decides the windows. Tests that need a window to have run out set it in the
 * past (the window ended before the workflow waits on it); the others set it in the future.
 */
describe('enforcement ladder', () => {
  let api: ReviewApi;

  const reviewerA: Caller = {
    sub: 'reviewer-a',
    tenant: 'psc',
    roles: ['reviewer'],
    name: 'Amina Wafula',
  };
  const reviewerB: Caller = {
    sub: 'reviewer-b',
    tenant: 'psc',
    roles: ['reviewer'],
    name: 'Brian Ochieng',
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

  /** A day in the past: every window set from it has run out. */
  const PAST = '2026-01-05T08:00:00.000Z';
  /** A day in the future: every window set from it is still running. */
  const FUTURE = '2027-12-20T08:00:00.000Z';

  let obligation: StoredObligation;
  let declarant: Caller;

  beforeAll(async () => {
    api = await startReviewApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    api.directory.givenCommission('psc');
    api.directory.givenCommission('tsc');
    obligation = overdueObligation({
      tenant: 'psc',
      declarantName: 'Grace Wanjiru',
      personnelFileNumber: 'PSC/2019/0077',
    });
    api.declarations.givenObligation(obligation);
    declarant = {
      sub: 'declarant-grace',
      roles: ['declarant'],
      personId: obligation.personId ?? undefined,
    };
  });

  const overdue = (subject: StoredObligation = obligation) =>
    api.enforcement.obligationStatusChanged(
      obligationStatusChangedEvent(subject.tenant, subject.obligationId, 'due', 'overdue'),
    );

  const filed = (subject: StoredObligation = obligation) => {
    api.declarations.setObligationStatus(subject.obligationId, 'filed');
    return api.enforcement.obligationStatusChanged(
      obligationStatusChangedEvent(subject.tenant, subject.obligationId, 'overdue', 'filed'),
    );
  };

  /** The obligation's ladder once its latest step is `step` in `status`. */
  const stepIs = (step: string, status: string, subjectId = obligation.obligationId) =>
    ladderWhen(api, 'obligation', subjectId, ({ actions }) =>
      actions.some((action) => action.step === step && action.status === status),
    );

  const outboxOf = async (type: string) =>
    (await api.asPlatform((tx) => tx.select().from(outbox).orderBy(asc(outbox.createdAt))))
      .filter((event) => event.envelope.type === type)
      .map((event) => event.envelope);

  const temporal = () => api.app.get<Client>(TEMPORAL_CLIENT);

  it('S5: overdue → notice drafted (system); a reviewer approves: ADM, letter, notification, issued; after the window the warning; approved and issued', async () => {
    api.clock.set(PAST);

    await overdue();
    const drafted = await stepIs('notice-to-comply', 'proposed');
    const notice = drafted.actions[0];
    if (!notice) throw new Error('no notice');
    expect(drafted.ladder).toMatchObject({
      tenant: 'psc',
      subjectKind: 'obligation',
      subjectId: obligation.obligationId,
      personId: obligation.personId,
      rosterRecordId: obligation.rosterRecordId,
      caseId: null,
      subjectReference: 'biennial:2027',
      declarantName: 'Grace Wanjiru',
      personnelFileNumber: 'PSC/2019/0077',
      status: 'active',
      currentActionId: notice.id,
      run: 1,
    });
    expect(notice).toMatchObject({
      step: 'notice-to-comply',
      status: 'proposed',
      proposerKind: 'system',
      proposer: null,
      reference: null,
    });

    // The Actions view.
    const view = await api.get(`/v1/review/ladders/${drafted.ladder.id}`, reviewerB);
    expect(view.statusCode, view.body).toBe(200);
    expect(contractErrors(okResponse('/v1/review/ladders/{ladderId}', 'get'), view.json())).toEqual(
      [],
    );
    expect(view.json<LadderView>()).toMatchObject({
      status: 'active',
      currentStep: 'notice-to-comply',
      closingCause: null,
      steps: [{ id: notice.id, status: 'proposed', proposerKind: 'system', proposer: null }],
    });

    // A reviewer who never held anything of the declarant's approves the notice.
    const response = await approveAction(api, notice.id, reviewerB);
    expect(response.statusCode, response.body).toBe(200);
    const approved = response.json<ActionView>();
    expect(
      contractErrors(okResponse('/v1/review/actions/{actionId}/approve', 'post'), approved),
    ).toEqual([]);
    expect(approved).toMatchObject({
      status: 'approved',
      approver: { subject: 'reviewer-b', name: 'Brian Ochieng' },
      approvedAt: PAST,
    });
    expect(approved.reference).toMatch(/^ADM-PSC-2026-0000001-[0-9A-Z]$/);
    expect(parse(approved.reference ?? '')).toMatchObject({
      scheme: 'ADM',
      issuer: 'PSC',
      period: 2026,
      sequence: 1,
    });

    // The workflow: the Restricted letter, pulled by action id, then email and SMS by person.
    const letter = await vi.waitFor(
      () => {
        expect(api.documents.issued).toHaveLength(1);
        return api.documents.issued[0];
      },
      { timeout: 45_000, interval: 250 },
    );
    expect(letter?.request).toEqual({
      type: 'notice-to-comply',
      templateVersion: 1,
      subjectRef: `action:${notice.id}`,
      subjectPersonId: obligation.personId,
      payload: { actionId: notice.id },
    });
    expect(letter?.tenant).toBe('psc');
    expect(
      contractErrors(
        okResponse('/internal/v1/review/actions/{actionId}/letter-payload', 'get'),
        letter?.pulled.body,
      ),
    ).toEqual([]);
    expect(letter?.pulled.body).toEqual({
      declarantPersonId: obligation.personId,
      declarantName: 'Grace Wanjiru',
      personnelFileNumber: 'PSC/2019/0077',
      commission: { name: 'Public Service Commission', issuerCode: 'PSC' },
      reference: approved.reference,
      step: 'notice-to-comply',
      stepLabel: 'Notice to comply',
      subjectKind: 'obligation',
      subjectReference: 'biennial:2027',
      whatToDo: 'file-declaration',
      issuedAt: PAST,
      // Fourteen days: the directory's policy has no ladder windows, so spec 08's apply.
      actBy: '2026-01-19T08:00:00.000Z',
      salaryStoppedFrom: null,
      respondUrl: `http://localhost:3010/notices/${notice.id}`,
    });
    const noticeParams = {
      commission: 'Public Service Commission',
      reference: approved.reference,
      step: 'Notice to comply',
      actBy: '2026-01-19',
      portalUrl: `http://localhost:3010/notices/${notice.id}`,
    };
    await vi.waitFor(
      () => {
        expect(api.notifications.sent.length).toBeGreaterThanOrEqual(2);
      },
      {
        timeout: 45_000,
        interval: 250,
      },
    );
    expect(api.notifications.sent.slice(0, 2)).toEqual([
      expect.objectContaining({
        channel: 'email',
        personId: obligation.personId,
        template: 'notice-email',
        tenant: 'psc',
        params: noticeParams,
      }),
      expect.objectContaining({
        channel: 'sms',
        personId: obligation.personId,
        template: 'notice-sms',
        tenant: 'psc',
        params: noticeParams,
      }),
    ]);

    // The notice's window has run out: the warning is drafted for approval.
    const warned = await stepIs('warning', 'proposed');
    const warning = warned.actions.find((action) => action.step === 'warning');
    if (!warning) throw new Error('no warning');
    expect(warned.actions.find((action) => action.id === notice.id)).toMatchObject({
      status: 'issued',
      issuedAt: new Date(PAST),
      windowEndsAt: new Date('2026-01-19T08:00:00.000Z'),
    });
    expect(warned.ladder.currentActionId).toBe(warning.id);

    // A supervisor approves the warning; it is issued the same way.
    const second = await approveAction(api, warning.id, supervisorS);
    expect(second.statusCode, second.body).toBe(200);
    const warningReference = second.json<ActionView>().reference;
    expect(warningReference).toMatch(/^ADM-PSC-2026-0000002-[0-9A-Z]$/);
    await stepIs('warning', 'issued');
    await vi.waitFor(
      () => {
        expect(api.documents.issued).toHaveLength(2);
      },
      {
        timeout: 45_000,
        interval: 250,
      },
    );
    expect(api.documents.issued[1]?.request).toMatchObject({
      type: 'warning',
      payload: { actionId: warning.id },
    });
    expect(api.notifications.sent.map((message) => message.template)).toEqual([
      'notice-email',
      'notice-sms',
      'notice-email',
      'notice-sms',
    ]);
    // After the warning's window the salary stoppage waits for a supervisor.
    const stoppage = await stepIs('salary-stoppage', 'proposed');
    expect(stoppage.ladder.status).toBe('active');
    expect(stoppage.actions.map((action) => [action.step, action.status])).toEqual([
      ['notice-to-comply', 'issued'],
      ['warning', 'issued'],
      ['salary-stoppage', 'proposed'],
    ]);

    // History and events: who did what, identifiers only (S19).
    const history = await api.asPlatform((tx) =>
      tx
        .select()
        .from(ladderHistory)
        .where(eq(ladderHistory.ladderId, drafted.ladder.id))
        .orderBy(asc(ladderHistory.at), asc(ladderHistory.id)),
    );
    expect(history.map((entry) => [entry.kind, entry.actor])).toEqual([
      ['ladder-started', 'system:review'],
      ['action-proposed', 'system:review'],
      ['action-approved', 'reviewer-b'],
      ['action-issued', 'system:review'],
      ['action-proposed', 'system:review'],
      ['action-approved', 'supervisor-s'],
      ['action-issued', 'system:review'],
      ['action-proposed', 'system:review'],
    ]);
    expect(await outboxOf('action.approved.v1')).toMatchObject([
      {
        subject: notice.id,
        tenant: 'psc',
        data: {
          actionId: notice.id,
          ladderId: drafted.ladder.id,
          subjectKind: 'obligation',
          subjectId: obligation.obligationId,
          step: 'notice-to-comply',
          proposerKind: 'system',
          approver: 'reviewer-b',
          reference: approved.reference,
        },
      },
      { subject: warning.id, data: { step: 'warning', approver: 'supervisor-s' } },
    ]);
    expect(await outboxOf('action.proposed.v1')).toHaveLength(3);
    expect(await outboxOf('action.issued.v1')).toHaveLength(2);
    for (const type of ['action.proposed.v1', 'action.approved.v1', 'action.issued.v1']) {
      for (const event of await outboxOf(type)) {
        expect(JSON.stringify(event.data)).not.toMatch(/Wanjiru|Grace|PSC\/2019|biennial|Ochieng/);
      }
    }

    // Temporal history carries identifiers, steps and instants only.
    const payloads = await historyPayloads(
      temporal(),
      enforcementWorkflowId('obligation', obligation.obligationId),
    );
    expect(payloads).toContain(notice.id);
    expect(payloads).not.toMatch(/Wanjiru|Grace|PSC\/2019|ADM-|biennial:|Ochieng|Notice to comply/);

    // Decided: approving again is a 409.
    const again = await approveAction(api, notice.id, supervisorS);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'not-proposed' });
  }, 120_000);

  it('S5: the event handled once; the same obligation announced overdue again starts nothing', async () => {
    api.clock.set(FUTURE);
    const event = obligationStatusChangedEvent('psc', obligation.obligationId, 'due', 'overdue');

    await api.enforcement.obligationStatusChanged(event);
    await api.enforcement.obligationStatusChanged(event);
    await overdue();
    await stepIs('notice-to-comply', 'proposed');

    const found = await ladderOf(api, 'obligation', obligation.obligationId);
    expect(found?.actions).toHaveLength(1);
    expect(await outboxOf('action.proposed.v1')).toHaveLength(1);
    // Other transitions start nothing.
    const other = overdueObligation({ tenant: 'psc' });
    api.declarations.givenObligation(other);
    await api.enforcement.obligationStatusChanged(
      obligationStatusChangedEvent('psc', other.obligationId, 'upcoming', 'due'),
    );
    expect(await ladderOf(api, 'obligation', other.obligationId)).toBeNull();
  });

  it('S5: the approvals inbox lists the drafted step with its subject for supervisors', async () => {
    api.clock.set(FUTURE);
    await overdue();
    const { ladder, actions } = await stepIs('notice-to-comply', 'proposed');

    const inbox = await api.get('/v1/commissions/psc/approvals?kind=action', supervisorS);

    expect(inbox.statusCode, inbox.body).toBe(200);
    expect(
      contractErrors(okResponse('/v1/commissions/{slug}/approvals', 'get'), inbox.json()),
    ).toEqual([]);
    expect(inbox.json()).toMatchObject({
      items: [
        {
          kind: 'action',
          subjectId: actions[0]?.id,
          proposerKind: 'system',
          proposer: null,
          canApprove: true,
          cannotApproveReason: null,
          summary: {
            ladderId: ladder.id,
            step: 'notice-to-comply',
            subjectKind: 'obligation',
            subjectReference: 'biennial:2027',
            declarantName: 'Grace Wanjiru',
            priorSteps: [],
          },
        },
      ],
      counts: { action: 1 },
    });
  });

  it('S7: filing during the notice window: the notice complied, the ladder complied, the workflow ends', async () => {
    api.clock.set(FUTURE);
    await overdue();
    const { actions } = await stepIs('notice-to-comply', 'proposed');
    const noticeId = actions[0]?.id ?? '';
    expect((await approveAction(api, noticeId, reviewerA)).statusCode).toBe(200);
    await stepIs('notice-to-comply', 'issued');

    await filed();

    const closed = await ladderWhen(
      api,
      'obligation',
      obligation.obligationId,
      ({ ladder }) => ladder.status === 'complied',
    );
    expect(closed.ladder).toMatchObject({ closingCause: 'filed', endedAt: new Date(FUTURE) });
    expect(closed.actions).toMatchObject([{ status: 'complied', compliedAt: new Date(FUTURE) }]);
    const result: unknown = await temporal()
      .workflow.getHandle(enforcementWorkflowId('obligation', obligation.obligationId))
      .result();
    expect(result).toEqual({ outcome: 'complied', cause: 'filed' });
    expect(await outboxOf('action.complied.v1')).toMatchObject([
      { subject: noticeId, data: { actionId: noticeId, cause: 'filed', step: 'notice-to-comply' } },
    ]);
    const view = await api.get(`/v1/review/ladders/${closed.ladder.id}`, reviewerB);
    expect(view.json<LadderView>()).toMatchObject({
      status: 'complied',
      closingCause: 'filed',
      endedAt: FUTURE,
    });
  });

  it('S7: filing while the notice waits for approval: the draft cancelled, the ladder complied', async () => {
    api.clock.set(FUTURE);
    await overdue();
    const { actions } = await stepIs('notice-to-comply', 'proposed');

    await filed();

    const closed = await ladderWhen(
      api,
      'obligation',
      obligation.obligationId,
      ({ ladder }) => ladder.status === 'complied',
    );
    expect(closed.actions).toMatchObject([{ status: 'cancelled' }]);
    expect(await outboxOf('action.cancelled.v1')).toMatchObject([
      { subject: actions[0]?.id, data: { cause: 'filed' } },
    ]);
    const late = await approveAction(api, actions[0]?.id ?? '', reviewerB);
    expect(late.statusCode).toBe(409);
    expect(api.documents.issued).toHaveLength(0);
  });

  it('S8: declining the notice with a note ends the ladder, declined; a supervisor restarts it with a new draft', async () => {
    api.clock.set(FUTURE);
    await overdue();
    const { ladder, actions } = await stepIs('notice-to-comply', 'proposed');
    const noticeId = actions[0]?.id ?? '';

    const declined = await declineAction(
      api,
      noticeId,
      reviewerB,
      'The officer is on study leave.',
    );
    expect(declined.statusCode, declined.body).toBe(200);
    expect(
      contractErrors(okResponse('/v1/review/actions/{actionId}/decline', 'post'), declined.json()),
    ).toEqual([]);
    expect(declined.json<ActionView>()).toMatchObject({
      status: 'declined',
      declinedBy: { subject: 'reviewer-b', name: 'Brian Ochieng' },
      declinedAt: FUTURE,
      declineNote: 'The officer is on study leave.',
      reference: null,
    });
    const workflowId = enforcementWorkflowId('obligation', obligation.obligationId);
    expect(await temporal().workflow.getHandle(workflowId).result()).toEqual({
      outcome: 'declined',
      step: 'notice-to-comply',
    });
    expect((await ladderOf(api, 'obligation', obligation.obligationId))?.ladder).toMatchObject({
      status: 'declined',
      endedAt: new Date(FUTURE),
    });
    const [event] = await outboxOf('action.declined.v1');
    expect(event?.data).toMatchObject({ actionId: noticeId, approver: 'reviewer-b' });
    expect(JSON.stringify(event?.data)).not.toMatch(/study leave/);
    expect(api.documents.issued).toHaveLength(0);
    const twice = await declineAction(api, noticeId, supervisorS, 'Again.');
    expect(twice.statusCode).toBe(409);

    // Restarting is a supervisor's.
    const byReviewer = await api.send('POST', `/v1/review/ladders/${ladder.id}/restart`, reviewerB);
    expect(byReviewer.statusCode).toBe(403);
    expect(byReviewer.json()).toMatchObject({ code: 'supervisor-required' });

    const restarted = await api.send(
      'POST',
      `/v1/review/ladders/${ladder.id}/restart`,
      supervisorS,
    );
    expect(restarted.statusCode, restarted.body).toBe(200);
    expect(
      contractErrors(okResponse('/v1/review/ladders/{ladderId}/restart', 'post'), restarted.json()),
    ).toEqual([]);
    expect(restarted.json<LadderView>()).toMatchObject({ status: 'active', endedAt: null });

    const redrafted = await ladderWhen(
      api,
      'obligation',
      obligation.obligationId,
      ({ actions: steps }) => steps.length === 2,
    );
    expect(redrafted.ladder.run).toBe(2);
    expect(redrafted.actions.map((action) => [action.step, action.status, action.run])).toEqual([
      ['notice-to-comply', 'declined', 1],
      ['notice-to-comply', 'proposed', 2],
    ]);
    expect(await outboxOf('ladder.restarted.v1')).toMatchObject([
      {
        subject: ladder.id,
        data: { ladderId: ladder.id, step: 'notice-to-comply', run: 2, by: 'supervisor-s' },
      },
    ]);
    const again = await api.send('POST', `/v1/review/ladders/${ladder.id}/restart`, supervisorS);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'ladder-not-declined' });
  });

  it("S9: the declarant responds to the notice with text and two attachments; the next step's approver sees it; the clock runs on", async () => {
    api.clock.set(PAST);
    await overdue();
    const { actions } = await stepIs('notice-to-comply', 'proposed');
    const noticeId = actions[0]?.id ?? '';
    expect((await approveAction(api, noticeId, reviewerB)).statusCode).toBe(200);
    // The response does not stop the ladder: the warning follows the notice's window.
    await stepIs('warning', 'proposed');
    await vi.waitFor(
      () => {
        expect(api.documents.issued).toHaveLength(1);
      },
      {
        timeout: 45_000,
        interval: 250,
      },
    );

    const mine = await api.get('/v1/me/notices', declarant);
    expect(mine.statusCode, mine.body).toBe(200);
    expect(contractErrors(okResponse('/v1/me/notices', 'get'), mine.json())).toEqual([]);
    const letterId = api.documents.issued[0]?.document.id ?? '';
    expect(mine.json<DeclarantNoticeView[]>()).toEqual([
      {
        actionId: noticeId,
        commission: { slug: 'psc', name: 'Public Service Commission' },
        step: 'notice-to-comply',
        status: 'issued',
        issuedAt: PAST,
        actBy: '2026-01-19T08:00:00.000Z',
        whatToDo: 'file-declaration',
        reference: expect.stringMatching(/^ADM-PSC-2026-/) as string,
        letterDownloadUrl: `http://localhost:3010/api/documents/${letterId}/download`,
        response: null,
        salaryStoppedAt: null,
        salaryReinstatedAt: null,
      },
    ]);

    const uploads = [randomUUID(), randomUUID()];
    for (const uploadId of uploads) {
      api.documents.givenUpload(uploadId, { tenant: 'psc', purpose: 'clarification-attachment' });
    }
    const text = 'I was on medical leave; my declaration is attached.';
    const respond = (caller: Caller, id = noticeId) =>
      api.send(
        'POST',
        `/v1/me/notices/${id}/response`,
        caller,
        { text, attachments: uploads },
        { 'idempotency-key': randomUUID() },
      );

    const responded = await respond(declarant);
    expect(responded.statusCode, responded.body).toBe(201);
    expect(
      contractErrors(
        okResponse('/v1/me/notices/{actionId}/response', 'post', 201),
        responded.json(),
      ),
    ).toEqual([]);
    expect(responded.json<DeclarantNoticeView>()).toMatchObject({
      status: 'responded',
      response: {
        text,
        attachments: uploads.map((uploadId) => ({
          uploadId,
          fileName: `${uploadId.slice(0, 8)}.pdf`,
        })),
        submittedAt: PAST,
      },
    });
    const twice = await respond(declarant);
    expect(twice.statusCode).toBe(409);
    expect(twice.json()).toMatchObject({ code: 'already-responded' });

    // The approver of the warning reads the response beside the notice.
    const inbox = await api.get('/v1/commissions/psc/approvals?kind=action', supervisorS);
    expect(inbox.json()).toMatchObject({
      items: [
        {
          summary: {
            step: 'warning',
            priorSteps: [
              {
                actionId: noticeId,
                step: 'notice-to-comply',
                status: 'responded',
                respondedAt: PAST,
                responseExcerpt: text,
                responseAttachments: 2,
              },
            ],
          },
        },
      ],
    });
    const ladder = await ladderOf(api, 'obligation', obligation.obligationId);
    const view = await api.get(`/v1/review/ladders/${ladder?.ladder.id ?? ''}`, reviewerB);
    expect(view.json<LadderView>().steps[0]?.response).toMatchObject({ text });
    expect(ladder?.ladder.status).toBe('active');

    const [event] = await outboxOf('action.responded.v1');
    expect(event?.data).toMatchObject({ actionId: noticeId, step: 'notice-to-comply' });
    expect(JSON.stringify(event?.data)).not.toMatch(/medical/);
  }, 120_000);

  it("S9: a response takes clean uploads for a response only, and the declarant's own issued notices only", async () => {
    api.clock.set(FUTURE);
    await overdue();
    const { actions } = await stepIs('notice-to-comply', 'proposed');
    const noticeId = actions[0]?.id ?? '';
    const respond = (caller: Caller, attachments: string[] = []) =>
      api.send(
        'POST',
        `/v1/me/notices/${noticeId}/response`,
        caller,
        { text: 'Filed today.', attachments },
        { 'idempotency-key': randomUUID() },
      );

    // Not issued yet: not the declarant's to see.
    expect((await respond(declarant)).statusCode).toBe(404);
    expect((await api.get('/v1/me/notices', declarant)).json()).toEqual([]);
    expect((await approveAction(api, noticeId, reviewerB)).statusCode).toBe(200);
    await stepIs('notice-to-comply', 'issued');

    const infected = randomUUID();
    api.documents.givenUpload(infected, {
      tenant: 'psc',
      purpose: 'clarification-attachment',
      state: 'infected',
    });
    const roster = randomUUID();
    api.documents.givenUpload(roster, { tenant: 'psc', purpose: 'roster-import' });
    expect((await respond(declarant, [infected])).json()).toMatchObject({
      code: 'attachment-not-clean',
    });
    expect((await respond(declarant, [roster])).json()).toMatchObject({
      code: 'attachment-not-accepted',
    });
    expect((await respond(declarant, [roster, roster])).statusCode).toBe(400);

    const stranger: Caller = {
      sub: 'declarant-other',
      roles: ['declarant'],
      personId: randomUUID(),
    };
    expect((await respond(stranger)).statusCode).toBe(404);
    expect((await api.get('/v1/me/notices', stranger)).json()).toEqual([]);
    expect((await respond(supervisorS)).statusCode).toBe(404);
    expect((await api.get('/v1/me/notices', supervisorS)).statusCode).toBe(404);
    expect((await respond(declarant)).statusCode).toBe(201);
  });

  it('S11: an unanswered clarification starts a ladder keyed by it; its reviewer of record cannot approve; the response complies', async () => {
    api.clock.set(FUTURE);
    const version = submittedVersion({
      tenant: 'psc',
      declarantName: 'James Otieno',
      personnelFileNumber: 'PSC/2019/0042',
      document: declaration([statement('officer', { assets: [asset({ description: 'Plot' })] })]),
    });
    api.declarations.given(version);
    const caseId = await givenWorkedCase(api, version, [reviewerA]);
    const clarificationId = randomUUID();
    await api.asPlatform((tx) =>
      tx.insert(clarifications).values({
        id: clarificationId,
        tenant: 'psc',
        caseId,
        personId: version.personId,
        reference: 'CLR-PSC-2027-0000009-K',
        status: 'overdue',
        items: [],
        issuedAt: new Date('2027-11-01T08:00:00.000Z'),
        dueAt: new Date('2027-12-01T08:00:00.000Z'),
        createdBy: 'reviewer-a',
      }),
    );

    await api.enforcement.clarificationOverdue(
      clarificationEvent('clarification.overdue.v1', 'psc', clarificationId, caseId),
    );
    const drafted = await ladderWhen(api, 'clarification', clarificationId, ({ actions }) =>
      actions.some((action) => action.status === 'proposed'),
    );
    expect(drafted.ladder).toMatchObject({
      subjectKind: 'clarification',
      personId: version.personId,
      caseId,
      // The case's roster record, from the declaration: a stoppage stops the salary on it.
      rosterRecordId: version.rosterRecordId,
      subjectReference: 'CLR-PSC-2027-0000009-K',
      declarantName: 'James Otieno',
      personnelFileNumber: 'PSC/2019/0042',
    });
    const noticeId = drafted.actions[0]?.id ?? '';

    // Reviewer A held the case: separation of duties.
    const own = await approveAction(api, noticeId, reviewerA);
    expect(own.statusCode).toBe(403);
    expect(own.json()).toMatchObject({
      code: 'separation-of-duties',
      reason: 'reviewer-of-record',
    });
    const inbox = await api.get('/v1/commissions/psc/approvals?kind=action', supervisorS);
    expect(inbox.json()).toMatchObject({ items: [{ subjectId: noticeId, canApprove: true }] });

    expect((await approveAction(api, noticeId, reviewerB)).statusCode).toBe(200);
    await ladderWhen(api, 'clarification', clarificationId, ({ actions }) =>
      actions.some((action) => action.status === 'issued'),
    );
    expect(api.documents.issued[0]?.pulled.body).toMatchObject({
      subjectKind: 'clarification',
      subjectReference: 'CLR-PSC-2027-0000009-K',
      whatToDo: 'respond-to-clarification',
    });

    await api.enforcement.clarificationResponded(
      clarificationEvent('clarification.responded.v1', 'psc', clarificationId, caseId),
    );
    const closed = await ladderWhen(
      api,
      'clarification',
      clarificationId,
      ({ ladder }) => ladder.status === 'complied',
    );
    expect(closed.ladder.closingCause).toBe('clarification-responded');
    expect(closed.actions).toMatchObject([{ status: 'complied' }]);
    expect(
      await temporal()
        .workflow.getHandle(enforcementWorkflowId('clarification', clarificationId))
        .result(),
    ).toEqual({ outcome: 'complied', cause: 'clarification-responded' });
  }, 120_000);

  describe('authorisation', () => {
    it("view ladders: the Commission's reviewers and supervisors; others 404", async () => {
      api.clock.set(FUTURE);
      await overdue();
      const { ladder } = await stepIs('notice-to-comply', 'proposed');

      const list = await api.get('/v1/commissions/psc/actions', reviewerA);
      expect(list.statusCode, list.body).toBe(200);
      expect(
        contractErrors(okResponse('/v1/commissions/{slug}/actions', 'get'), list.json()),
      ).toEqual([]);
      expect(list.json()).toMatchObject({ items: [{ id: ladder.id }], nextCursor: null });
      const filtered = await api.get('/v1/commissions/psc/actions?step=warning', supervisorS);
      expect(filtered.json()).toMatchObject({ items: [] });
      const proposed = await api.get('/v1/commissions/psc/actions?status=proposed', supervisorS);
      expect(proposed.json()).toMatchObject({ items: [{ id: ladder.id }] });

      for (const caller of [tscSupervisor, helpdesk, declarant]) {
        expect((await api.get('/v1/commissions/psc/actions', caller)).statusCode).toBe(404);
        expect((await api.get(`/v1/review/ladders/${ladder.id}`, caller)).statusCode).toBe(404);
      }
    });

    it('decide: another Commission, helpdesk and declarants get 404; a validated note and a key are required', async () => {
      api.clock.set(FUTURE);
      await overdue();
      const { ladder, actions } = await stepIs('notice-to-comply', 'proposed');
      const noticeId = actions[0]?.id ?? '';

      for (const caller of [tscSupervisor, helpdesk, declarant]) {
        expect((await approveAction(api, noticeId, caller)).statusCode).toBe(404);
        expect((await declineAction(api, noticeId, caller, 'No.')).statusCode).toBe(404);
        expect(
          (await api.send('POST', `/v1/review/ladders/${ladder.id}/restart`, caller)).statusCode,
        ).toBe(404);
      }
      expect((await declineAction(api, noticeId, reviewerB, ' ')).statusCode).toBe(400);
      const noKey = await api.send('POST', `/v1/review/actions/${noticeId}/approve`, reviewerB);
      expect(noKey.statusCode).toBe(400);
    });

    it('the letter payload: approved steps only, and only with a review:internal service token', async () => {
      api.clock.set(FUTURE);
      await overdue();
      const { actions } = await stepIs('notice-to-comply', 'proposed');
      const noticeId = actions[0]?.id ?? '';
      const url = `/internal/v1/review/actions/${noticeId}/letter-payload`;
      const headers = { 'x-acting-tenant': 'psc' };

      expect((await api.get(url, documentsService, headers)).statusCode).toBe(404);
      await approveAction(api, noticeId, reviewerB);
      await stepIs('notice-to-comply', 'issued');
      expect((await api.get(url, documentsService, headers)).statusCode).toBe(200);
      expect((await api.get(url, documentsService, { 'x-acting-tenant': 'tsc' })).statusCode).toBe(
        404,
      );
      expect((await api.get(url, supervisorS, headers)).statusCode).toBe(403);
    });
  });
});
