import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ApprovalPage } from '../../src/approvals/approvals.service.js';
import { outbox } from '../../src/db/schema.js';
import type { DeterminationView } from '../../src/determinations/representation.js';
import { declaration, statement } from '../fixtures/declarations.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { approve, givenWorkedCase, propose } from '../support/determinations.js';
import { submittedVersion } from '../support/fake-declarations.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';

/**
 * S14 at the HTTP seam, with the authorisation matrix rows for approvals: the supervisors' inbox
 * lists the Commission's pending proposals oldest first with `canApprove` computed for the caller
 * by the separation-of-duties rule, counts by kind and age, and a supervisor reassigns an approval
 * to another supervisor (informational: the rule still decides).
 */
describe('approvals inbox and reassignment', () => {
  let api: ReviewApi;

  const reviewerA: Caller = { sub: 'reviewer-a', tenant: 'psc', roles: ['reviewer'] };
  const supervisorR: Caller = {
    sub: 'supervisor-r',
    tenant: 'psc',
    roles: ['supervisor'],
    name: 'Rose Kamau',
  };
  const supervisorP: Caller = {
    sub: 'supervisor-p',
    tenant: 'psc',
    roles: ['supervisor'],
    name: 'Peter Mwangi',
  };
  const supervisorS: Caller = {
    sub: 'supervisor-s',
    tenant: 'psc',
    roles: ['supervisor'],
    name: 'Samuel Njoroge',
  };
  const tscSupervisor: Caller = { sub: 'supervisor-t', tenant: 'tsc', roles: ['supervisor'] };

  const first = submittedVersion({
    tenant: 'psc',
    declarantName: 'James Otieno',
    document: declaration([statement('officer', {})]),
  });
  const second = submittedVersion({
    tenant: 'psc',
    declarantName: 'Mary Achieng',
    document: declaration([statement('officer', {})]),
  });
  const third = submittedVersion({
    tenant: 'psc',
    declarantName: 'Ali Hassan',
    document: declaration([statement('officer', {})]),
  });

  const inbox = '/v1/commissions/psc/approvals';
  const inboxPage = okResponse('/v1/commissions/{slug}/approvals', 'get');

  beforeAll(async () => {
    api = await startReviewApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    api.directory.givenCommission('psc');
    api.declarations.given(first, second, third);
  });

  /**
   * Case one: held by supervisor R, then reviewer A, who proposed on 1 November (49 days before
   * the inbox is read). Case two: held and proposed by supervisor P on 20 December.
   */
  async function givenTwoProposals() {
    api.clock.set('2027-11-01T08:00:00.000Z');
    const caseOne = await givenWorkedCase(api, first, [supervisorR, reviewerA]);
    const one = (await propose(api, caseOne, reviewerA)).json<DeterminationView>();
    api.clock.set('2027-12-20T08:00:00.000Z');
    const caseTwo = await givenWorkedCase(api, second, [supervisorP]);
    const two = (
      await propose(api, caseTwo, supervisorP, { outcome: 'compliant', reasons: 'No issues.' })
    ).json<DeterminationView>();
    return { caseOne, one, caseTwo, two };
  }

  it('S14: lists proposals oldest first with canApprove computed per caller', async () => {
    const { caseOne, one, two } = await givenTwoProposals();

    const asR = await api.get(inbox, supervisorR);
    expect(asR.statusCode, asR.body).toBe(200);
    expect(contractErrors(inboxPage, asR.json())).toEqual([]);
    const page = asR.json<ApprovalPage>();
    expect(page.nextCursor).toBeNull();
    expect(page.items).toEqual([
      {
        kind: 'determination',
        subjectId: one.id,
        proposedAt: '2027-11-01T08:00:00.000Z',
        proposerKind: 'user',
        proposer: { subject: 'reviewer-a', name: 'reviewer-a' },
        summary: {
          caseId: caseOne,
          caseReference: first.reference,
          declarantName: 'James Otieno',
          personnelFileNumber: first.personnelFileNumber,
          outcome: 'non-compliant',
          reasonsExcerpt: 'The declarant omitted the spouse vehicle acquired in 2026.',
        },
        canApprove: false,
        cannotApproveReason: 'reviewer-of-record',
        reassignedTo: null,
      },
      expect.objectContaining({
        subjectId: two.id,
        proposer: { subject: 'supervisor-p', name: 'Peter Mwangi' },
        canApprove: true,
        cannotApproveReason: null,
      }),
    ]);

    const asP = (await api.get(inbox, supervisorP)).json<ApprovalPage>();
    expect(asP.items.map((item) => [item.subjectId, item.cannotApproveReason])).toEqual([
      [one.id, null],
      [two.id, 'proposer'],
    ]);
    const asS = (await api.get(inbox, supervisorS)).json<ApprovalPage>();
    expect(asS.items.every((item) => item.canApprove)).toBe(true);
  });

  it('S14: counts by kind and by age; decided proposals leave the inbox', async () => {
    const { one } = await givenTwoProposals();
    api.clock.set('2027-12-20T09:00:00.000Z');
    const caseThree = await givenWorkedCase(api, third, [reviewerA]);
    const three = (await propose(api, caseThree, reviewerA)).json<DeterminationView>();

    const before = (await api.get(inbox, supervisorS)).json<ApprovalPage>();
    expect(before.counts).toEqual({
      determination: 3,
      action: 0,
      referral: 0,
      'under-7-days': 2,
      '7-to-30-days': 0,
      'over-30-days': 1,
      'determination:under-7-days': 2,
      'determination:7-to-30-days': 0,
      'determination:over-30-days': 1,
      'action:under-7-days': 0,
      'action:7-to-30-days': 0,
      'action:over-30-days': 0,
      'referral:under-7-days': 0,
      'referral:7-to-30-days': 0,
      'referral:over-30-days': 0,
    });

    expect((await approve(api, one.id, supervisorS)).statusCode).toBe(200);
    expect(
      (await api.send('POST', `/v1/review/determinations/${three.id}/withdraw`, reviewerA))
        .statusCode,
    ).toBe(200);

    const after = (await api.get(inbox, supervisorS)).json<ApprovalPage>();
    expect(after.items).toHaveLength(1);
    expect(after.counts).toMatchObject({ determination: 1, 'over-30-days': 0 });
  });

  it('S14: pages with a cursor and filters by kind', async () => {
    const { one, two } = await givenTwoProposals();

    const firstPage = (await api.get(`${inbox}?limit=1`, supervisorS)).json<ApprovalPage>();
    expect(firstPage.items.map((item) => item.subjectId)).toEqual([one.id]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const secondPage = await api.get(
      `${inbox}?limit=1&cursor=${firstPage.nextCursor ?? ''}`,
      supervisorS,
    );
    expect(contractErrors(inboxPage, secondPage.json())).toEqual([]);
    expect(secondPage.json<ApprovalPage>().items.map((item) => item.subjectId)).toEqual([two.id]);
    expect(secondPage.json<ApprovalPage>().nextCursor).toBeNull();

    const referrals = (await api.get(`${inbox}?kind=referral`, supervisorS)).json<ApprovalPage>();
    expect(referrals.items).toEqual([]);
    expect(referrals.counts).toMatchObject({ determination: 2 });

    expect((await api.get(`${inbox}?cursor=nonsense`, supervisorS)).statusCode).toBe(400);
    expect((await api.get(`${inbox}?kind=other`, supervisorS)).statusCode).toBe(400);
  });

  it('S14: a conflicted supervisor reassigns an approval to another supervisor', async () => {
    const { one } = await givenTwoProposals();
    const url = `/v1/review/approvals/determination/${one.id}/reassign`;

    const response = await api.send('POST', url, supervisorR, { toSupervisor: 'supervisor-p' });

    expect(response.statusCode, response.body).toBe(200);
    expect(
      contractErrors(
        okResponse('/v1/review/approvals/{kind}/{subjectId}/reassign', 'post'),
        response.json(),
      ),
    ).toEqual([]);
    // Supervisor P's name is known from the case they held.
    expect(response.json()).toEqual({
      kind: 'determination',
      subjectId: one.id,
      reassignedTo: { subject: 'supervisor-p', name: 'Peter Mwangi' },
    });
    const listed = (await api.get(inbox, supervisorP)).json<ApprovalPage>();
    expect(listed.items[0]).toMatchObject({
      subjectId: one.id,
      reassignedTo: { subject: 'supervisor-p', name: 'Peter Mwangi' },
      canApprove: true,
    });
    const events = (await api.asPlatform((tx) => tx.select().from(outbox)))
      .map((event) => event.envelope)
      .filter((envelope) => envelope.type === 'approval.reassigned.v1');
    expect(events).toMatchObject([
      {
        subject: one.id,
        tenant: 'psc',
        data: {
          kind: 'determination',
          subjectId: one.id,
          toSupervisor: 'supervisor-p',
          by: 'supervisor-r',
        },
      },
    ]);

    // Informational: the rule still decides. Supervisor R still cannot approve.
    expect((await approve(api, one.id, supervisorR)).statusCode).toBe(403);
    // Reassigned again, the latest wins.
    await api.send('POST', url, supervisorP, { toSupervisor: 'supervisor-s' });
    const relisted = (await api.get(inbox, supervisorS)).json<ApprovalPage>();
    expect(relisted.items[0]?.reassignedTo).toEqual({
      subject: 'supervisor-s',
      name: 'supervisor-s',
    });
  });

  it('reassign: supervisors only; unknown or decided approvals are 404 and 409', async () => {
    const { one, two } = await givenTwoProposals();
    const url = (kind: string, id: string) => `/v1/review/approvals/${kind}/${id}/reassign`;
    const body = { toSupervisor: 'supervisor-s' };

    const byReviewer = await api.send('POST', url('determination', one.id), reviewerA, body);
    expect(byReviewer.statusCode).toBe(403);
    expect(byReviewer.json()).toMatchObject({ code: 'supervisor-required' });
    expect((await api.send('POST', url('action', one.id), supervisorS, body)).statusCode).toBe(404);
    expect(
      (await api.send('POST', url('determination', two.caseId), supervisorS, body)).statusCode,
    ).toBe(404);
    expect(
      (await api.send('POST', url('determination', one.id), tscSupervisor, body)).statusCode,
    ).toBe(404);
    expect(
      (await api.send('POST', url('determination', one.id), supervisorS, { toSupervisor: '' }))
        .statusCode,
    ).toBe(400);

    await approve(api, two.id, supervisorS);
    const decided = await api.send('POST', url('determination', two.id), supervisorR, body);
    expect(decided.statusCode).toBe(409);
    expect(decided.json()).toMatchObject({ code: 'not-proposed' });
  });

  it('inbox: reviewers get 403; another Commission, declarants and helpdesk 404', async () => {
    await givenTwoProposals();

    const byReviewer = await api.get(inbox, reviewerA);
    expect(byReviewer.statusCode).toBe(403);
    expect(byReviewer.json()).toMatchObject({ code: 'supervisor-required' });
    expect((await api.get(inbox, tscSupervisor)).statusCode).toBe(404);
    expect((await api.get('/v1/commissions/tsc/approvals', supervisorS)).statusCode).toBe(404);
    expect(
      (
        await api.get(inbox, {
          sub: 'declarant-d',
          roles: ['declarant'],
          personId: first.personId,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await api.get(inbox, { sub: 'helpdesk-h', tenant: 'psc', roles: ['helpdesk'] })).statusCode,
    ).toBe(404);
  });
});
