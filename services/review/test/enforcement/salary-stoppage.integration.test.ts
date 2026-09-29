import { randomUUID } from 'node:crypto';

import { TEMPORAL_CLIENT } from '@adili/temporal';
import type { Client } from '@temporalio/client';
import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ladderHistory, outbox } from '../../src/db/schema.js';
import { DECIDED_SIGNAL, enforcementWorkflowId } from '../../src/enforcement/contract.js';
import type { DeclarantNoticeView } from '../../src/enforcement/declarant-notices.service.js';
import type { ActionView, LadderView } from '../../src/enforcement/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  approveAction,
  declineAction,
  ladderOf,
  ladderWhen,
  obligationStatusChangedEvent,
} from '../support/enforcement.js';
import { overdueObligation, type StoredObligation } from '../support/fake-declarations.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';
import { historyPayloads } from '../support/workflow-history.js';

/**
 * The ladder's later steps (spec 08 S5 stoppage, S6, S7 with the stoppage, S10, S15) at the inbox,
 * HTTP and payroll seams, with `EnforcementWorkflow` on Temporal and the integration-gateway faked
 * as the payroll mock behaves: after the warning's window the salary stoppage is drafted for a
 * supervisor; approved, payroll gets `stop_salary` (reference: the stoppage's `ADM` reference;
 * roster facts from the directory at send time) and its acknowledgement is stored before the
 * letter and the messages; compliance reinstates the salary (`resume_salary`, `-R`); after the
 * stoppage's window the disciplinary referral is drafted for a supervisor, issued to the declarant
 * and announced for the employer; payroll outages are retried and never stop a salary twice.
 *
 * The service clock decides the windows: in the past, every window has run out by the time the
 * workflow waits on it; in the future, it is still running.
 */
describe('salary stoppage, reinstatement and disciplinary referral', () => {
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
  const supervisorT: Caller = {
    sub: 'supervisor-t',
    tenant: 'psc',
    roles: ['supervisor'],
    name: 'Tabitha Achieng',
  };
  const tscSupervisor: Caller = { sub: 'supervisor-x', tenant: 'tsc', roles: ['supervisor'] };
  const helpdesk: Caller = { sub: 'helpdesk-h', tenant: 'psc', roles: ['helpdesk'] };
  const documentsService: Caller = {
    sub: 'service-account-documents',
    scopes: ['review:internal'],
  };

  /** A day in the past: every window set from it has run out. */
  const PAST = '2026-01-05T08:00:00.000Z';
  /** A day in the future: every window set from it is still running. */
  const FUTURE = '2027-12-20T08:00:00.000Z';

  const ROSTER = {
    personalNumber: 'PSC/2019/0077',
    nationalId: '27451863',
    employerCode: 'MOH',
    reportingEntityId: '0199b000-0000-7000-8000-0000000000e7',
  };

  let obligation: StoredObligation;
  let declarant: Caller;

  beforeAll(async () => {
    api = await startReviewApi();
  });

  afterAll(async () => {
    await api.close();
  });

  // A ladder left running would write while the next test empties the tables.
  afterEach(async () => {
    await temporal()
      .workflow.getHandle(workflowId())
      .terminate('test over')
      .catch(() => undefined);
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
    api.directory.givenRosterRecord('psc', obligation.rosterRecordId, ROSTER);
    api.gateway.receiveAt(() => api.clock.now());
    declarant = {
      sub: 'declarant-grace',
      roles: ['declarant'],
      personId: obligation.personId ?? undefined,
    };
  });

  const overdue = () =>
    api.enforcement.obligationStatusChanged(
      obligationStatusChangedEvent('psc', obligation.obligationId, 'due', 'overdue'),
    );

  const filed = () => {
    api.declarations.setObligationStatus(obligation.obligationId, 'filed');
    return api.enforcement.obligationStatusChanged(
      obligationStatusChangedEvent('psc', obligation.obligationId, 'overdue', 'filed'),
    );
  };

  /** The obligation's ladder once its `step` is in `status`. */
  const stepIs = (step: string, status: string) =>
    ladderWhen(api, 'obligation', obligation.obligationId, ({ actions }) =>
      actions.some((action) => action.step === step && action.status === status),
    );

  const actionOf = async (step: string, status: string) => {
    const { actions } = await stepIs(step, status);
    const found = actions.find((action) => action.step === step);
    if (!found) throw new Error(`no ${step}`);
    return found;
  };

  const waitFor = <T>(check: () => T | Promise<T>) =>
    vi.waitFor(check, { timeout: 45_000, interval: 250 });

  const outboxOf = async (type: string) =>
    (await api.asPlatform((tx) => tx.select().from(outbox).orderBy(asc(outbox.createdAt))))
      .filter((event) => event.envelope.type === type)
      .map((event) => event.envelope);

  const temporal = () => api.app.get<Client>(TEMPORAL_CLIENT);
  const workflowId = () => enforcementWorkflowId('obligation', obligation.obligationId);

  /**
   * The ladder up to the drafted salary stoppage: the notice approved by a reviewer and the
   * warning by a supervisor, both issued, their windows run out (the clock in the past).
   */
  async function draftedStoppage() {
    api.clock.set(PAST);
    await overdue();
    const notice = await actionOf('notice-to-comply', 'proposed');
    expect((await approveAction(api, notice.id, reviewerB)).statusCode).toBe(200);
    const warning = await actionOf('warning', 'proposed');
    expect((await approveAction(api, warning.id, supervisorS)).statusCode).toBe(200);
    const stoppage = await actionOf('salary-stoppage', 'proposed');
    return { notice, warning, stoppage };
  }

  it('S5, S6: the stoppage is drafted for a supervisor with the steps before it; a supervisor approves: payroll stop acknowledged, letter, messages, issued', async () => {
    const { notice, warning, stoppage } = await draftedStoppage();
    expect(stoppage).toMatchObject({ proposerKind: 'system', reference: null, run: 1 });
    expect(api.gateway.calls).toHaveLength(0);

    // The approvals inbox shows it to supervisors with the notice and warning before it.
    const inbox = await api.get('/v1/commissions/psc/approvals?kind=action', supervisorT);
    expect(inbox.statusCode, inbox.body).toBe(200);
    expect(
      contractErrors(okResponse('/v1/commissions/{slug}/approvals', 'get'), inbox.json()),
    ).toEqual([]);
    expect(inbox.json()).toMatchObject({
      items: [
        {
          kind: 'action',
          subjectId: stoppage.id,
          canApprove: true,
          summary: {
            step: 'salary-stoppage',
            priorSteps: [
              { actionId: notice.id, step: 'notice-to-comply', status: 'issued' },
              { actionId: warning.id, step: 'warning', status: 'issued' },
            ],
          },
        },
      ],
      counts: { action: 1 },
    });
    // Reviewers have no inbox, and may not approve or decline a stoppage.
    expect((await api.get('/v1/commissions/psc/approvals', reviewerA)).statusCode).toBe(403);
    const byReviewer = await approveAction(api, stoppage.id, reviewerA);
    expect(byReviewer.statusCode).toBe(403);
    expect(byReviewer.json()).toMatchObject({ code: 'supervisor-required' });
    const declinedByReviewer = await declineAction(api, stoppage.id, reviewerA, 'Not yet.');
    expect(declinedByReviewer.statusCode).toBe(403);

    const approved = await approveAction(api, stoppage.id, supervisorT);
    expect(approved.statusCode, approved.body).toBe(200);
    const reference = approved.json<ActionView>().reference ?? '';
    expect(reference).toMatch(/^ADM-PSC-2026-0000003-[0-9A-Z]$/);

    // Payroll: one stop_salary, by the ADM reference, with the roster's facts read now.
    const issued = await actionOf('salary-stoppage', 'issued');
    expect(api.gateway.instructions).toHaveLength(1);
    const [stop] = api.gateway.instructions;
    expect(stop?.request).toEqual({
      instructionReference: reference,
      employerCode: 'MOH',
      personalNumber: 'PSC/2019/0077',
      nationalId: '27451863',
      action: 'stop_salary',
      reason: `Salary stoppage ${reference} under the Administrative Mechanisms for failure to file a declaration of income, assets and liabilities`,
      effectiveDate: '2026-01-05',
    });
    expect(stop?.context).toEqual({ tenant: 'psc' });
    expect(api.directory.rosterReads).toContainEqual({
      tenant: 'psc',
      recordId: obligation.rosterRecordId,
    });
    expect(issued).toMatchObject({
      payrollStopReference: reference,
      payrollStopAck: {
        instructionReference: reference,
        action: 'stop_salary',
        status: 'accepted',
        payrollReference: stop?.acknowledgement.payrollReference,
        receivedAt: PAST,
      },
      salaryStopEffectiveDate: '2026-01-05',
      salaryStoppedAt: new Date(PAST),
      windowEndsAt: new Date('2026-02-04T08:00:00.000Z'),
    });

    // The Restricted letter, pulled by action id, after the stop.
    const letter = await waitFor(() => {
      const found = api.documents.issued.find(
        (issuedLetter) => issuedLetter.request.type === 'salary-stoppage',
      );
      if (!found) throw new Error('no letter');
      return found;
    });
    expect(letter.request).toMatchObject({
      type: 'salary-stoppage',
      disclosureLevel: 'restricted',
      subjectRef: `action:${stoppage.id}`,
      subjectPersonId: obligation.personId,
      payload: { actionId: stoppage.id },
      publicPayload: { reference, type: 'salary-stoppage' },
    });
    expect(
      contractErrors(
        okResponse('/internal/v1/review/actions/{actionId}/letter-payload', 'get'),
        letter.pulled.body,
      ),
    ).toEqual([]);
    expect(letter.pulled.body).toMatchObject({
      reference,
      step: 'salary-stoppage',
      stepLabel: 'Salary stoppage',
      actBy: '2026-02-04T08:00:00.000Z',
      salaryStoppedFrom: '2026-01-05',
    });

    // The declarant told by person, email and SMS.
    await waitFor(() => {
      expect(
        api.notifications.sent.filter((message) => message.template.startsWith('salary-stopped')),
      ).toHaveLength(2);
    });
    const stopParams = {
      commission: 'Public Service Commission',
      reference,
      stoppedFrom: '2026-01-05',
      actBy: '2026-02-04',
      portalUrl: `http://localhost:3010/notices/${stoppage.id}`,
    };
    expect(api.notifications.sent.slice(4)).toEqual([
      expect.objectContaining({
        channel: 'email',
        personId: obligation.personId,
        template: 'salary-stopped-email',
        params: stopParams,
      }),
      expect.objectContaining({
        channel: 'sms',
        personId: obligation.personId,
        template: 'salary-stopped-sms',
        params: stopParams,
      }),
    ]);

    // The Actions view shows the acknowledgement; the declarant's notice when the salary stopped.
    const view = await api.get(`/v1/review/ladders/${issued.ladderId}`, reviewerA);
    expect(contractErrors(okResponse('/v1/review/ladders/{ladderId}', 'get'), view.json())).toEqual(
      [],
    );
    expect(
      view.json<LadderView>().steps.find((step) => step.id === stoppage.id)?.payrollStop,
    ).toMatchObject({ instructionReference: reference, status: 'accepted' });
    const mine = await api.get('/v1/me/notices', declarant);
    expect(contractErrors(okResponse('/v1/me/notices', 'get'), mine.json())).toEqual([]);
    expect(
      mine.json<DeclarantNoticeView[]>().find((notice) => notice.actionId === stoppage.id),
    ).toMatchObject({
      step: 'salary-stoppage',
      status: 'issued',
      reference,
      salaryStoppedAt: PAST,
      salaryReinstatedAt: null,
    });
    // A stoppage takes no response.
    const response = await api.send(
      'POST',
      `/v1/me/notices/${stoppage.id}/response`,
      declarant,
      { text: 'Please reconsider.', attachments: [] },
      { 'idempotency-key': randomUUID() },
    );
    expect(response.statusCode).toBe(409);

    // History and events: identifiers only.
    const history = await api.asPlatform((tx) =>
      tx
        .select()
        .from(ladderHistory)
        .where(eq(ladderHistory.actionId, stoppage.id))
        .orderBy(asc(ladderHistory.at), asc(ladderHistory.id)),
    );
    expect(history.map((entry) => [entry.kind, entry.actor])).toEqual([
      ['action-proposed', 'system:review'],
      ['action-approved', 'supervisor-t'],
      ['payroll-instruction-sent', 'system:review'],
      ['payroll-instruction-acknowledged', 'system:review'],
      ['action-issued', 'system:review'],
    ]);
    expect(await outboxOf('payroll.instruction.sent.v1')).toMatchObject([
      {
        subject: stoppage.id,
        data: { actionId: stoppage.id, instructionReference: reference, action: 'stop_salary' },
      },
    ]);
    expect(await outboxOf('payroll.instruction.acknowledged.v1')).toMatchObject([
      {
        subject: stoppage.id,
        data: {
          actionId: stoppage.id,
          instructionReference: reference,
          action: 'stop_salary',
          status: 'accepted',
        },
      },
    ]);
    for (const type of [
      'payroll.instruction.sent.v1',
      'payroll.instruction.acknowledged.v1',
      'action.approved.v1',
      'action.issued.v1',
    ]) {
      for (const event of await outboxOf(type)) {
        expect(JSON.stringify(event.data)).not.toMatch(/Wanjiru|27451863|PSC\/2019|MOH|failure/);
      }
    }

    // The stoppage's window has run out: the disciplinary referral waits for a supervisor.
    await actionOf('disciplinary-referral', 'proposed');

    // Temporal history carries identifiers, steps and instants only.
    const payloads = await historyPayloads(temporal(), workflowId());
    expect(payloads).toContain(stoppage.id);
    expect(payloads).not.toMatch(
      /Wanjiru|Grace|PSC\/2019|27451863|MOH|ADM-|Administrative Mechanisms|Salary stoppage|Njoroge|Achieng/,
    );
  }, 150_000);

  it('S7: filing while the salary is stopped: steps complied, resume_salary sent (-R), acknowledged, reinstated, the declarant told; the ladder ends', async () => {
    const { notice, warning, stoppage } = await draftedStoppage();
    // From here the windows run: the stoppage's window is still open when the declarant files.
    api.clock.set(FUTURE);
    const approved = await approveAction(api, stoppage.id, supervisorS);
    const reference = approved.json<ActionView>().reference ?? '';
    await actionOf('salary-stoppage', 'issued');

    await filed();

    const reinstated = await actionOf('salary-stoppage', 'reinstated');
    expect(reinstated).toMatchObject({
      payrollResumeReference: `${reference}-R`,
      payrollResumeAck: {
        instructionReference: `${reference}-R`,
        action: 'resume_salary',
        status: 'accepted',
      },
      salaryReinstatedAt: new Date(FUTURE),
    });
    expect(api.gateway.instructions.map(({ request }) => request)).toEqual([
      expect.objectContaining({ instructionReference: reference, action: 'stop_salary' }),
      {
        instructionReference: `${reference}-R`,
        employerCode: 'MOH',
        personalNumber: 'PSC/2019/0077',
        nationalId: '27451863',
        action: 'resume_salary',
        reason: `Compliance after salary stoppage ${reference}: salary reinstated`,
        effectiveDate: '2027-12-20',
      },
    ]);
    const { ladder, actions } = await ladderWhen(
      api,
      'obligation',
      obligation.obligationId,
      ({ ladder: found }) => found.status === 'complied',
    );
    expect(ladder).toMatchObject({ closingCause: 'filed' });
    expect(actions.map((action) => [action.id, action.status])).toEqual([
      [notice.id, 'complied'],
      [warning.id, 'complied'],
      [stoppage.id, 'reinstated'],
    ]);

    await waitFor(() => {
      expect(
        api.notifications.sent.filter((message) =>
          message.template.startsWith('salary-reinstated'),
        ),
      ).toHaveLength(2);
    });
    expect(
      api.notifications.sent.filter((message) => message.template.startsWith('salary-reinstated')),
    ).toEqual([
      expect.objectContaining({
        channel: 'email',
        personId: obligation.personId,
        template: 'salary-reinstated-email',
        params: {
          commission: 'Public Service Commission',
          reference,
          reinstatedOn: '2027-12-20',
          portalUrl: `http://localhost:3010/notices/${stoppage.id}`,
        },
      }),
      expect.objectContaining({ channel: 'sms', template: 'salary-reinstated-sms' }),
    ]);
    const result: unknown = await temporal().workflow.getHandle(workflowId()).result();
    expect(result).toEqual({ outcome: 'complied', cause: 'filed' });

    // The declarant's notice shows the reinstatement; the view the resume's acknowledgement.
    const mine = await api.get('/v1/me/notices', declarant);
    expect(contractErrors(okResponse('/v1/me/notices', 'get'), mine.json())).toEqual([]);
    expect(
      mine.json<DeclarantNoticeView[]>().find((found) => found.actionId === stoppage.id),
    ).toMatchObject({
      status: 'reinstated',
      salaryStoppedAt: FUTURE,
      salaryReinstatedAt: FUTURE,
    });
    const view = await api.get(`/v1/review/ladders/${ladder.id}`, reviewerA);
    expect(contractErrors(okResponse('/v1/review/ladders/{ladderId}', 'get'), view.json())).toEqual(
      [],
    );
    expect(
      view.json<LadderView>().steps.find((step) => step.id === stoppage.id)?.payrollResume,
    ).toMatchObject({ instructionReference: `${reference}-R`, action: 'resume_salary' });

    expect(await outboxOf('action.reinstated.v1')).toMatchObject([
      { subject: stoppage.id, data: { actionId: stoppage.id, step: 'salary-stoppage' } },
    ]);
    expect(await outboxOf('action.complied.v1')).toHaveLength(3);
    expect(
      (await outboxOf('payroll.instruction.acknowledged.v1')).map((event) => event.data),
    ).toMatchObject([{ action: 'stop_salary' }, { action: 'resume_salary' }]);
    const payloads = await historyPayloads(temporal(), workflowId());
    expect(payloads).not.toMatch(/Wanjiru|PSC\/2019|27451863|MOH|ADM-|reinstated on/);
  }, 150_000);

  it('the obligation cancelled while the salary is stopped: the ladder ends and the salary is still reinstated (resume_salary, -R), the declarant told', async () => {
    const { stoppage } = await draftedStoppage();
    api.clock.set(FUTURE);
    const approved = await approveAction(api, stoppage.id, supervisorS);
    const reference = approved.json<ActionView>().reference ?? '';
    await actionOf('salary-stoppage', 'issued');

    api.declarations.setObligationStatus(obligation.obligationId, 'cancelled');
    await api.enforcement.obligationStatusChanged(
      obligationStatusChangedEvent('psc', obligation.obligationId, 'overdue', 'cancelled'),
    );

    const reinstated = await actionOf('salary-stoppage', 'reinstated');
    expect(reinstated).toMatchObject({
      payrollResumeReference: `${reference}-R`,
      payrollResumeAck: { action: 'resume_salary', status: 'accepted' },
      salaryReinstatedAt: new Date(FUTURE),
    });
    expect(api.gateway.instructions.map(({ request }) => request).at(-1)).toMatchObject({
      instructionReference: `${reference}-R`,
      action: 'resume_salary',
      reason: `Administrative action ended (filing obligation cancelled) after salary stoppage ${reference}: salary reinstated`,
    });
    const { ladder } = await ladderWhen(
      api,
      'obligation',
      obligation.obligationId,
      ({ ladder: found }) => found.status === 'ended',
    );
    expect(ladder).toMatchObject({ closingCause: 'obligation-cancelled' });
    await waitFor(() => {
      expect(
        api.notifications.sent
          .filter((message) => message.template.startsWith('salary-reinstated'))
          .map((message) => message.channel),
      ).toEqual(['email', 'sms']);
    });
    const result: unknown = await temporal().workflow.getHandle(workflowId()).result();
    expect(result).toEqual({ outcome: 'ended', cause: 'obligation-cancelled' });
    expect(await outboxOf('action.reinstated.v1')).toMatchObject([{ subject: stoppage.id }]);
  }, 150_000);

  it('S7: filing before the stoppage is approved cancels the draft; nothing goes to payroll', async () => {
    const { stoppage } = await draftedStoppage();

    await filed();

    const { actions } = await ladderWhen(
      api,
      'obligation',
      obligation.obligationId,
      ({ ladder }) => ladder.status === 'complied',
    );
    expect(actions.find((action) => action.id === stoppage.id)?.status).toBe('cancelled');
    const result: unknown = await temporal().workflow.getHandle(workflowId()).result();
    expect(result).toEqual({ outcome: 'complied', cause: 'filed' });
    expect(api.gateway.calls).toHaveLength(0);
    expect(
      api.notifications.sent.filter((message) => message.template.startsWith('salary')),
    ).toHaveLength(0);
  }, 150_000);

  it('S10: after the stoppage window the referral is drafted; a supervisor approves: ADM, letter, employer event, no message; the ladder waits; filing reinstates', async () => {
    const { stoppage } = await draftedStoppage();
    expect((await approveAction(api, stoppage.id, supervisorS)).statusCode).toBe(200);
    const referral = await actionOf('disciplinary-referral', 'proposed');

    const byReviewer = await approveAction(api, referral.id, reviewerB);
    expect(byReviewer.statusCode).toBe(403);
    expect(byReviewer.json()).toMatchObject({ code: 'supervisor-required' });
    const approved = await approveAction(api, referral.id, supervisorT);
    expect(approved.statusCode, approved.body).toBe(200);
    const reference = approved.json<ActionView>().reference ?? '';
    expect(reference).toMatch(/^ADM-PSC-2026-0000004-[0-9A-Z]$/);

    const issued = await actionOf('disciplinary-referral', 'issued');
    expect(issued).toMatchObject({ reference, issuedAt: new Date(PAST), windowEndsAt: null });
    const letter = await waitFor(() => {
      const found = api.documents.issued.find(
        (issuedLetter) => issuedLetter.request.type === 'disciplinary-referral',
      );
      if (!found) throw new Error('no letter');
      return found;
    });
    expect(letter.request).toMatchObject({
      disclosureLevel: 'restricted',
      subjectPersonId: obligation.personId,
      payload: { actionId: referral.id },
      publicPayload: { reference, type: 'disciplinary-referral' },
    });
    expect(
      contractErrors(
        okResponse('/internal/v1/review/actions/{actionId}/letter-payload', 'get'),
        letter.pulled.body,
      ),
    ).toEqual([]);
    expect(letter.pulled.body).toMatchObject({
      step: 'disciplinary-referral',
      stepLabel: 'Disciplinary referral',
      actBy: null,
      salaryStoppedFrom: null,
    });
    // The employer (the reporting entity) is told by event; the declarant by the letter only.
    expect(await outboxOf('action.disciplinary-referred.v1')).toEqual([
      expect.objectContaining({
        subject: referral.id,
        tenant: 'psc',
        data: {
          actionId: referral.id,
          ladderId: referral.ladderId,
          subjectKind: 'obligation',
          subjectId: obligation.obligationId,
          step: 'disciplinary-referral',
          proposerKind: 'system',
          approver: 'supervisor-t',
          reference,
          personId: obligation.personId,
          rosterRecordId: obligation.rosterRecordId,
          reportingEntityId: ROSTER.reportingEntityId,
        },
      }),
    ]);
    expect(api.notifications.sent.map((message) => message.template)).toEqual([
      'notice-email',
      'notice-sms',
      'notice-email',
      'notice-sms',
      'salary-stopped-email',
      'salary-stopped-sms',
    ]);
    const mine = await api.get('/v1/me/notices', declarant);
    expect(contractErrors(okResponse('/v1/me/notices', 'get'), mine.json())).toEqual([]);
    expect(
      mine.json<DeclarantNoticeView[]>().find((found) => found.actionId === referral.id),
    ).toMatchObject({ step: 'disciplinary-referral', status: 'issued', actBy: null });
    const waiting = await ladderOf(api, 'obligation', obligation.obligationId);
    expect(waiting?.ladder.status).toBe('active');

    await filed();

    const reinstated = await actionOf('salary-stoppage', 'reinstated');
    expect(reinstated.payrollResumeAck).toMatchObject({ action: 'resume_salary' });
    const { actions } = await ladderWhen(
      api,
      'obligation',
      obligation.obligationId,
      ({ ladder }) => ladder.status === 'complied',
    );
    expect(actions.find((action) => action.id === referral.id)?.status).toBe('complied');
  }, 150_000);

  it('S10: a declined referral leaves the ladder waiting (not declined, not restartable), the salary stopped until the declarant complies', async () => {
    const { stoppage } = await draftedStoppage();
    expect((await approveAction(api, stoppage.id, supervisorS)).statusCode).toBe(200);
    const referral = await actionOf('disciplinary-referral', 'proposed');

    const declined = await declineAction(api, referral.id, supervisorT, 'The employer is aware.');
    expect(declined.statusCode, declined.body).toBe(200);
    expect(declined.json<ActionView>()).toMatchObject({
      status: 'declined',
      declineNote: 'The employer is aware.',
    });
    const waiting = await ladderOf(api, 'obligation', obligation.obligationId);
    expect(waiting?.ladder).toMatchObject({ status: 'active', endedAt: null });
    const restart = await api.send(
      'POST',
      `/v1/review/ladders/${referral.ladderId}/restart`,
      supervisorS,
    );
    expect(restart.statusCode).toBe(409);
    expect(api.documents.issued.map((issued) => issued.request.type)).not.toContain(
      'disciplinary-referral',
    );
    expect(await outboxOf('action.disciplinary-referred.v1')).toHaveLength(0);
    expect(api.gateway.instructions.map(({ request }) => request.action)).toEqual(['stop_salary']);

    await filed();

    await actionOf('salary-stoppage', 'reinstated');
    const result: unknown = await temporal().workflow.getHandle(workflowId()).result();
    expect(result).toEqual({ outcome: 'complied', cause: 'filed' });
    expect(api.gateway.instructions.map(({ request }) => request.action)).toEqual([
      'stop_salary',
      'resume_salary',
    ]);
  }, 150_000);

  it('S6: a declined stoppage ends the ladder, declined; a supervisor restarts it at the stoppage', async () => {
    const { stoppage } = await draftedStoppage();

    const declined = await declineAction(api, stoppage.id, supervisorS, 'Response under review.');
    expect(declined.statusCode, declined.body).toBe(200);
    const ended = await ladderWhen(
      api,
      'obligation',
      obligation.obligationId,
      ({ ladder }) => ladder.status === 'declined',
    );
    const result: unknown = await temporal().workflow.getHandle(workflowId()).result();
    expect(result).toEqual({ outcome: 'declined', step: 'salary-stoppage' });
    expect(api.gateway.calls).toHaveLength(0);

    const restarted = await api.send(
      'POST',
      `/v1/review/ladders/${ended.ladder.id}/restart`,
      supervisorT,
    );
    expect(restarted.statusCode, restarted.body).toBe(200);
    const redrafted = await ladderWhen(api, 'obligation', obligation.obligationId, ({ actions }) =>
      actions.some(
        (action) =>
          action.step === 'salary-stoppage' && action.status === 'proposed' && action.run === 2,
      ),
    );
    expect(redrafted.ladder).toMatchObject({ status: 'active', run: 2 });
  }, 150_000);

  it('S15: payroll unavailable: the stoppage stays approved-pending-payroll with nothing issued, retried with backoff until payroll acknowledges', async () => {
    const { stoppage } = await draftedStoppage();
    // The directory's roster record has no employer code: the Commission's issuer code is sent.
    api.directory.givenRosterRecord('psc', obligation.rosterRecordId, {
      ...ROSTER,
      employerCode: null,
    });
    api.gateway.failCalls(3);

    const approved = await approveAction(api, stoppage.id, supervisorS);
    const reference = approved.json<ActionView>().reference ?? '';

    const pending = await actionOf('salary-stoppage', 'approved-pending-payroll');
    expect(pending).toMatchObject({ payrollStopReference: reference, payrollStopAck: null });
    const view = await api.get(`/v1/review/ladders/${pending.ladderId}`, reviewerA);
    expect(view.json<LadderView>().steps.find((step) => step.id === stoppage.id)).toMatchObject({
      status: 'approved-pending-payroll',
      payrollStop: null,
      letter: null,
    });
    expect(api.documents.issued.map((issued) => issued.request.type)).not.toContain(
      'salary-stoppage',
    );

    const issued = await actionOf('salary-stoppage', 'issued');
    expect(api.gateway.calls.length).toBeGreaterThanOrEqual(4);
    expect(api.gateway.instructions).toHaveLength(1);
    expect(api.gateway.instructions[0]?.request).toMatchObject({
      instructionReference: reference,
      employerCode: 'PSC',
    });
    expect(issued.payrollStopAck).toMatchObject({ status: 'accepted' });
    expect(await outboxOf('payroll.instruction.sent.v1')).toHaveLength(1);
    expect(await outboxOf('payroll.instruction.acknowledged.v1')).toHaveLength(1);
  }, 150_000);

  it('S15: a lost acknowledgement and a replayed approval never stop a salary twice: one instruction per reference', async () => {
    const { stoppage } = await draftedStoppage();
    // Payroll takes the stop but the answer is lost: the retry gets the stored acknowledgement.
    api.gateway.loseResponses(1);

    const approved = await approveAction(api, stoppage.id, supervisorS);
    const reference = approved.json<ActionView>().reference ?? '';
    const issued = await actionOf('salary-stoppage', 'issued');

    // The approval replayed: refused; the workflow told again: nothing sent again.
    const again = await approveAction(api, stoppage.id, supervisorT);
    expect(again.statusCode).toBe(409);
    await temporal().workflow.getHandle(workflowId()).signal(DECIDED_SIGNAL);
    await actionOf('disciplinary-referral', 'proposed');

    const stops = api.gateway.calls.filter(({ request }) => request.action === 'stop_salary');
    expect(stops.length).toBeGreaterThanOrEqual(2);
    expect(new Set(stops.map(({ request }) => request.instructionReference))).toEqual(
      new Set([reference]),
    );
    expect(api.gateway.instructions).toHaveLength(1);
    expect(issued.payrollStopAck).toMatchObject({
      payrollReference: api.gateway.instructions[0]?.acknowledgement.payrollReference,
    });
    expect(await outboxOf('payroll.instruction.acknowledged.v1')).toHaveLength(1);
  }, 150_000);

  describe('authorisation', () => {
    it('stoppage and referral decisions: supervisors of the Commission only; reviewers 403; another Commission, helpdesk and declarants 404', async () => {
      const { stoppage } = await draftedStoppage();

      for (const reviewer of [reviewerA, reviewerB]) {
        const approve = await approveAction(api, stoppage.id, reviewer);
        expect(approve.statusCode).toBe(403);
        expect(approve.json()).toMatchObject({ code: 'supervisor-required' });
        expect((await declineAction(api, stoppage.id, reviewer, 'No.')).statusCode).toBe(403);
      }
      for (const caller of [tscSupervisor, helpdesk, declarant]) {
        expect((await approveAction(api, stoppage.id, caller)).statusCode).toBe(404);
        expect((await declineAction(api, stoppage.id, caller, 'No.')).statusCode).toBe(404);
      }
      const inbox = await api.get('/v1/commissions/psc/approvals?kind=action', supervisorS);
      expect(inbox.json()).toMatchObject({
        items: [{ subjectId: stoppage.id, canApprove: true, cannotApproveReason: null }],
      });
      expect(api.gateway.calls).toHaveLength(0);
    }, 150_000);

    it('the stoppage letter payload: with a review:internal service token only, once approved', async () => {
      const { stoppage } = await draftedStoppage();
      const url = `/internal/v1/review/actions/${stoppage.id}/letter-payload`;
      const headers = { 'x-acting-tenant': 'psc' };

      expect((await api.get(url, documentsService, headers)).statusCode).toBe(404);
      await approveAction(api, stoppage.id, supervisorS);
      await actionOf('salary-stoppage', 'issued');
      expect((await api.get(url, documentsService, headers)).statusCode).toBe(200);
      expect((await api.get(url, supervisorS, headers)).statusCode).toBe(403);
    }, 150_000);
  });
});
