import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { config } from '../../src/config.js';
import { outbox } from '../../src/db/schema.js';
import {
  REFERRAL_SWEEPS_WORKFLOW,
  referralSweepScheduleId,
  referralSweepWorkflowId,
} from '../../src/referrals/contract.js';
import { digest } from '../../src/referrals/evidence-package.js';
import { REFERRAL_PROPOSED, REFERRAL_SENT } from '../../src/referrals/events.js';
import { ReferralWorkflows } from '../../src/referrals/referral-workflows.js';
import type { ReferralView } from '../../src/referrals/representation.js';
import type { referralSweeps as referralSweepsWorkflow } from '../../src/referrals/workflows.js';
import { asset, declaration, statement } from '../fixtures/declarations.js';
import { temporalOf } from '../support/closures.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { givenWorkedCase } from '../support/determinations.js';
import { biennialObligation, submittedVersion } from '../support/fake-declarations.js';
import {
  approveReferral,
  givenIssuedClarification,
  givenLadder,
  referralRows,
  sentReferral,
} from '../support/referrals.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';
import { historyPayloads } from '../support/workflow-history.js';

/**
 * S12 at the workflow seam (with S16, the declarations person obligation history, faked): the
 * daily referral sweep, as its Temporal schedule starts it, proposes `two-missed-cycles` (proposer
 * `system`) for a person whose history shows two consecutive biennial cycles overdue and unfiled
 * past the ladder window (notice, warning and stoppage: 58 days by default), and
 * `unanswered-clarification` for a clarification whose ladder has run past the stoppage window
 * unanswered; once per person, grounds and cycle. Everyone else is left alone. Ids and counts
 * only in Temporal's history. A system proposal is approved like any other, its package listing
 * the obligations and the ladder's letters.
 */
describe('referral sweep (S12, S16 faked)', () => {
  let api: ReviewApi;

  const reviewerA: Caller = { sub: 'reviewer-a', tenant: 'psc', roles: ['reviewer'] };
  const supervisorS: Caller = { sub: 'supervisor-s', tenant: 'psc', roles: ['supervisor'] };
  /** 1 March 2028, 09:00 in Nairobi: 61 days after the 2027 cycle was due. */
  const SWEEP_DAY = '2028-03-01T06:00:00.000Z';

  const missing = randomUUID();
  const oneMissed = randomUUID();
  const tooSoon = randomUUID();
  const filedLate = randomUUID();
  const tscPerson = randomUUID();

  beforeAll(async () => {
    api = await startReviewApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    api.directory.givenCommission('psc');
    api.directory.givenCommission('tsc');
    api.clock.set(SWEEP_DAY);
  });

  /** Runs the day's sweep as the schedule would: `referralSweeps` on the service's worker. */
  function runSweeps(): Promise<{ swept: number }> {
    return temporalOf(api).workflow.execute<typeof referralSweepsWorkflow>(
      REFERRAL_SWEEPS_WORKFLOW,
      {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: `referral-sweeps-test-${randomUUID()}`,
        args: [],
      },
    );
  }

  /** A fresh sequence number for the references this suite arranges. */
  let sequence = 0;
  const next = () => String((sequence += 1)).padStart(7, '0');

  const eventsOf = async (type: string) =>
    (await api.asPlatform((tx) => tx.select().from(outbox)))
      .filter((event) => event.envelope.type === type)
      .map((event) => event.envelope);

  /** A person with an obligation ladder on their latest cycle, and their history. */
  async function givenObligationPerson(
    tenant: string,
    personId: string,
    history: ReturnType<typeof biennialObligation>[],
    names = { declarantName: 'Grace Wanjiru', personnelFileNumber: 'PSC/00417' },
  ) {
    api.declarations.givenPersonObligations(tenant, personId, ...history);
    const latest = history.at(-1);
    if (!latest) throw new Error('no history');
    const ladder = await givenLadder(api, {
      tenant,
      subjectKind: 'obligation',
      subjectId: latest.obligationId,
      personId,
      subjectReference: latest.cycleKey,
      startedAt: new Date(`${latest.dueDate}T21:00:00.000Z`),
      actionReference: `ADM-${tenant.toUpperCase()}-2028-${next()}-4`,
      ...names,
    });
    return { latest, ladder };
  }

  /**
   * An unanswered clarification of a case, its ladder running since `startedAt`; with
   * `stoppageWindowEndedAt`, the ladder reached salary stoppage and that window ended then.
   */
  async function givenUnansweredClarification(
    startedAt: string,
    status: 'overdue' | 'responded' = 'overdue',
    stoppageWindowEndedAt?: string,
  ) {
    const version = submittedVersion({
      tenant: 'psc',
      declarantName: 'Peter Mwangi',
      personnelFileNumber: 'PSC/00555',
      document: declaration([statement('officer', { assets: [asset()] })]),
    });
    api.declarations.given(version);
    const caseId = await givenWorkedCase(api, version, [reviewerA]);
    const reference = `CLR-PSC-2027-${next()}-3`;
    const clarification = await givenIssuedClarification(api, {
      tenant: 'psc',
      caseId,
      personId: version.personId,
      reference,
      status,
    });
    const ladder = await givenLadder(api, {
      tenant: 'psc',
      subjectKind: 'clarification',
      subjectId: clarification.clarificationId,
      personId: version.personId,
      caseId,
      subjectReference: reference,
      startedAt: new Date(startedAt),
      status: status === 'overdue' ? 'active' : 'complied',
      declarantName: 'Peter Mwangi',
      personnelFileNumber: 'PSC/00555',
      actionReference: `ADM-PSC-2027-${next()}-4`,
      ...(stoppageWindowEndedAt ? { stoppageWindowEndedAt: new Date(stoppageWindowEndedAt) } : {}),
    });
    return { version, caseId, clarification, ladder };
  }

  it('S12: proposes two-missed-cycles and unanswered-clarification once, leaving everyone else', async () => {
    const earlier = biennialObligation(2025);
    const { latest, ladder } = await givenObligationPerson('psc', missing, [
      biennialObligation(2023, { status: 'filed', filedAt: '2023-12-01T09:00:00.000Z' }),
      earlier,
      biennialObligation(2027),
    ]);
    await givenObligationPerson('psc', oneMissed, [
      biennialObligation(2025, { status: 'filed', filedAt: '2025-12-01T09:00:00.000Z' }),
      biennialObligation(2027),
    ]);
    // The later cycle fell due 15 January 2028: its ladder window runs to 13 March.
    await givenObligationPerson('psc', tooSoon, [
      biennialObligation(2025),
      biennialObligation(2027, { dueDate: '2028-01-15' }),
    ]);
    await givenObligationPerson('psc', filedLate, [
      biennialObligation(2025, { filedAt: '2026-02-01T09:00:00.000Z' }),
      biennialObligation(2027),
    ]);
    await givenObligationPerson(
      'tsc',
      tscPerson,
      [biennialObligation(2025), biennialObligation(2027)],
      {
        declarantName: 'Tom Otieno',
        personnelFileNumber: 'TSC/00001',
      },
    );
    const unanswered = await givenUnansweredClarification(
      '2027-12-27T06:00:00.000Z',
      'overdue',
      '2028-02-20T06:00:00.000Z',
    );
    // Overdue since 20 January: the ladder has not reached salary stoppage yet.
    await givenUnansweredClarification('2028-01-20T06:00:00.000Z');
    // Started as long ago, but stuck on its notice (never approved further): never reached salary
    // stoppage, so it is not past those windows.
    await givenUnansweredClarification('2027-12-27T06:00:00.000Z');
    // Salary stoppage issued, but its window has not ended.
    await givenUnansweredClarification(
      '2027-12-27T06:00:00.000Z',
      'overdue',
      '2028-03-20T06:00:00.000Z',
    );
    // Answered: its ladder complied.
    await givenUnansweredClarification(
      '2027-12-27T06:00:00.000Z',
      'responded',
      '2028-02-20T06:00:00.000Z',
    );

    expect(await runSweeps()).toEqual({ swept: 2 });

    const rows = await referralRows(api);
    expect(rows.map((row) => [row.tenant, row.personId, row.grounds]).sort()).toEqual(
      [
        ['psc', missing, 'two-missed-cycles'],
        ['psc', unanswered.version.personId, 'unanswered-clarification'],
        ['tsc', tscPerson, 'two-missed-cycles'],
      ].sort(),
    );
    const missedCycles = rows.find((row) => row.personId === missing);
    expect(missedCycles).toMatchObject({
      tenant: 'psc',
      caseId: null,
      cycleYear: 2027,
      proposerKind: 'system',
      proposer: null,
      proposedAt: new Date(SWEEP_DAY),
      status: 'proposed',
      declarantName: 'Grace Wanjiru',
      personnelFileNumber: 'PSC/00417',
      sources: {
        caseIds: [],
        flagIds: [],
        clarificationIds: [],
        obligationIds: [earlier.obligationId, latest.obligationId],
        actionIds: [ladder.actionId],
      },
    });
    expect(missedCycles?.narrative).toContain('2025 and 2027');
    const clarificationReferral = rows.find((row) => row.grounds === 'unanswered-clarification');
    expect(clarificationReferral).toMatchObject({
      caseId: unanswered.caseId,
      cycleYear: 2027,
      proposerKind: 'system',
      declarantName: 'Peter Mwangi',
      sources: {
        caseIds: [unanswered.caseId],
        flagIds: [],
        clarificationIds: [unanswered.clarification.clarificationId],
        obligationIds: [],
        actionIds: [unanswered.ladder.actionId, unanswered.ladder.stoppageActionId],
      },
    });

    // S16 faked: the history of every candidate was asked of declarations, per Commission.
    expect(api.declarations.historyReads).toEqual(
      expect.arrayContaining([
        { personId: missing, tenant: 'psc' },
        { personId: oneMissed, tenant: 'psc' },
        { personId: tooSoon, tenant: 'psc' },
        { personId: filedLate, tenant: 'psc' },
        { personId: tscPerson, tenant: 'tsc' },
      ]),
    );

    // Events: identifiers only, proposer the system.
    const proposed = await eventsOf(REFERRAL_PROPOSED);
    expect(proposed.map((event) => event.data)).toContainEqual({
      referralId: missedCycles?.id,
      tenant: 'psc',
      grounds: 'two-missed-cycles',
      cycleYear: 2027,
      personId: missing,
      proposerKind: 'system',
      proposer: null,
    });
    expect(JSON.stringify(proposed)).not.toContain('Grace Wanjiru');

    // Waiting in the supervisors' inbox; a system proposal has no proposer to keep out.
    const inbox = await api.get('/v1/commissions/psc/approvals?kind=referral', supervisorS);
    expect(inbox.statusCode).toBe(200);
    expect(
      contractErrors(okResponse('/v1/commissions/{slug}/approvals', 'get'), inbox.json()),
    ).toEqual([]);
    expect(inbox.json()).toMatchObject({
      items: [
        { proposerKind: 'system', proposer: null, canApprove: true },
        { proposerKind: 'system', proposer: null, canApprove: true },
      ],
      counts: { referral: 2 },
    });
    // The unanswered clarification's case was reviewer-a's: they may not approve (nor could any reviewer).
    const reviewerInbox = await api.send(
      'POST',
      `/v1/review/referrals/${clarificationReferral?.id ?? ''}/approve`,
      reviewerA,
      undefined,
      { 'idempotency-key': randomUUID() },
    );
    expect(reviewerInbox.statusCode).toBe(403);
    expect(reviewerInbox.json()).toMatchObject({ type: 'separation-of-duties' });

    // Ids and counts only in the sweep's history.
    const history = await historyPayloads(
      temporalOf(api),
      referralSweepWorkflowId('psc', '2028-03-01'),
    );
    expect(history).toContain(missing);
    for (const secret of [
      'Grace Wanjiru',
      'PSC/00417',
      'Peter Mwangi',
      'PSC/00555',
      'biennial:2027',
    ]) {
      expect(history).not.toContain(secret);
    }

    // The next day: nothing proposed twice for the same person, grounds and cycle.
    api.clock.set('2028-03-02T06:00:00.000Z');
    expect(await runSweeps()).toEqual({ swept: 2 });
    expect(await referralRows(api)).toHaveLength(3);
    expect(await eventsOf(REFERRAL_PROPOSED)).toHaveLength(3);
  });

  it('S12: an approved system proposal goes with the obligations and the ladder letters in its package', async () => {
    const earlier = biennialObligation(2025);
    const { latest, ladder } = await givenObligationPerson('psc', missing, [
      earlier,
      biennialObligation(2027),
    ]);
    await runSweeps();
    const [row] = await referralRows(api);
    if (!row) throw new Error('no proposal');

    const approved = await approveReferral(api, row.id, supervisorS);
    expect(approved.statusCode, approved.body).toBe(200);
    const sent: ReferralView = await sentReferral(api, row.id, supervisorS);

    expect(sent.reference).toMatch(/^RFL-PSC-2028-0000001-[0-9A-Z]$/);
    expect(sent.package?.manifest).toEqual([
      {
        kind: 'obligation',
        reference: 'biennial:2025',
        sha256: digest(earlier),
        documentId: null,
      },
      {
        kind: 'obligation',
        reference: 'biennial:2027',
        sha256: digest(latest),
        documentId: null,
      },
      {
        kind: 'letter',
        reference: ladder.actionReference,
        sha256: ladder.letterSha256,
        documentId: expect.any(String) as string,
      },
    ]);
    const [event] = await eventsOf(REFERRAL_SENT);
    expect(event?.data).toMatchObject({
      referralId: row.id,
      grounds: 'two-missed-cycles',
      proposerKind: 'system',
      approver: 'supervisor-s',
      reference: sent.reference,
    });
    expect(api.notifications.sent).toEqual([]);
  });

  it('keeps a daily Temporal schedule that starts the sweep', async () => {
    const scheduleId = await api.app.get(ReferralWorkflows).ensureSchedule('30 2 * * *');
    const handle = temporalOf(api).schedule.getHandle(scheduleId);
    try {
      expect(scheduleId).toBe(referralSweepScheduleId(config.TEMPORAL_TASK_QUEUE));
      const described = await handle.describe();
      expect(described.action).toMatchObject({
        type: 'startWorkflow',
        workflowType: REFERRAL_SWEEPS_WORKFLOW,
        taskQueue: config.TEMPORAL_TASK_QUEUE,
      });
      expect(described.spec.timezone).toBe('Africa/Nairobi');

      // Kept again on the next start: the existing schedule is updated, not duplicated.
      await api.app.get(ReferralWorkflows).ensureSchedule('0 3 * * *');
      expect((await handle.describe()).spec.calendars?.[0]?.hour).toEqual([
        { start: 3, end: 3, step: 1 },
      ]);
    } finally {
      await handle.delete();
    }
  });
});
