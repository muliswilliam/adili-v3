import { randomUUID } from 'node:crypto';

import { parse } from '@adili/numbering';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outbox } from '../../src/db/schema.js';
import { referralSendingWorkflowId } from '../../src/referrals/contract.js';
import { digest } from '../../src/referrals/evidence-package.js';
import {
  REFERRAL_APPROVED,
  REFERRAL_DECLINED,
  REFERRAL_PROPOSED,
  REFERRAL_SENT,
} from '../../src/referrals/events.js';
import type { ReferralView } from '../../src/referrals/representation.js';
import { asset, declaration, statement } from '../fixtures/declarations.js';
import { temporalOf } from '../support/closures.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { givenWorkedCase } from '../support/determinations.js';
import { submittedVersion } from '../support/fake-declarations.js';
import {
  approveReferral,
  declineReferral,
  type GivenClarification,
  type GivenLadder,
  givenFlag,
  givenIssuedClarification,
  givenLadder,
  proposeReferral,
  referralRows,
  sentReferral,
} from '../support/referrals.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';
import { historyPayloads } from '../support/workflow-history.js';

/**
 * S13 at the HTTP, inbox and workflow seams, with the authorisation rows for referrals: the case's
 * assignee proposes an assets referral selecting registry and comparison flags and a
 * clarification; it waits in the supervisors' approvals inbox with `canApprove` by the
 * separation-of-duties rule; an eligible supervisor's approval allocates `RFL` and the sending
 * workflow (on Temporal) pulls the evidence, stores the manifest with SHA-256 hashes, issues the
 * Confidential package through the fake documents service (which pulls the package payload) and
 * emits `referral.sent.v1`. The declarant is told nothing; workflow history carries ids only.
 */
describe('referrals: propose, approve with evidence package, decline (S13)', () => {
  let api: ReviewApi;

  const reviewerA: Caller = {
    sub: 'reviewer-a',
    tenant: 'psc',
    roles: ['reviewer'],
    name: 'Amina Wafula',
  };
  const reviewerB: Caller = { sub: 'reviewer-b', tenant: 'psc', roles: ['reviewer'] };
  /** A supervisor who once held the case: a reviewer of record. */
  const supervisorR: Caller = { sub: 'supervisor-r', tenant: 'psc', roles: ['supervisor'] };
  const supervisorS: Caller = {
    sub: 'supervisor-s',
    tenant: 'psc',
    roles: ['supervisor'],
    name: 'Samuel Njoroge',
  };
  const tscReviewer: Caller = { sub: 'reviewer-t', tenant: 'tsc', roles: ['reviewer'] };
  const tscSupervisor: Caller = { sub: 'supervisor-t', tenant: 'tsc', roles: ['supervisor'] };
  const helpdesk: Caller = { sub: 'helpdesk-h', tenant: 'psc', roles: ['helpdesk'] };

  const APPROVAL_DAY = '2027-12-20T06:00:00.000Z';
  const narrative =
    'NTSA records a vehicle registered to the officer in 2026 that is not declared, and assets grew faster than income.';

  const attachmentId = randomUUID();
  const version = submittedVersion({
    tenant: 'psc',
    declarantName: 'James Otieno',
    personnelFileNumber: 'PSC/00042',
    reference: 'DCB-PSC-2027-0000042-7',
    document: declaration([statement('officer', { assets: [asset({ description: 'Plot' })] })]),
    attachments: [
      {
        uploadId: attachmentId,
        itemId: randomUUID(),
        personKey: 'officer',
        fileName: 'title-deed.pdf',
        sha256: 'b'.repeat(64),
      },
    ],
  });
  const declarant: Caller = {
    sub: 'declarant-james',
    roles: ['declarant'],
    personId: version.personId,
  };

  let caseId: string;
  let registryFlag: string;
  let comparisonFlag: string;
  let lateFlag: string;
  let clarification: GivenClarification;
  let ladder: GivenLadder;

  beforeAll(async () => {
    api = await startReviewApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    api.directory.givenCommission('psc');
    api.directory.givenCommission('tsc');
    api.declarations.given(version);
    api.clock.set(APPROVAL_DAY);
    caseId = await givenWorkedCase(api, version, [supervisorR, reviewerA]);
    registryFlag = await givenFlag(
      api,
      'psc',
      caseId,
      version.versionId,
      'registry-vehicle-undeclared',
    );
    comparisonFlag = await givenFlag(
      api,
      'psc',
      caseId,
      version.versionId,
      'income-vs-asset-growth',
    );
    lateFlag = await givenFlag(api, 'psc', caseId, version.versionId, 'late-filing');
    clarification = await givenIssuedClarification(api, {
      tenant: 'psc',
      caseId,
      personId: version.personId,
      reference: 'CLR-PSC-2027-0000007-3',
      status: 'responded',
    });
    ladder = await givenLadder(api, {
      tenant: 'psc',
      subjectKind: 'clarification',
      subjectId: clarification.clarificationId,
      personId: version.personId,
      caseId,
      subjectReference: 'CLR-PSC-2027-0000007-3',
      startedAt: new Date('2027-12-27T06:00:00.000Z'),
      status: 'complied',
      actionReference: 'ADM-PSC-2027-0000003-5',
    });
  });

  const body = () => ({
    grounds: 'undeclared-assets',
    narrative,
    flagIds: [registryFlag, comparisonFlag],
    clarificationIds: [clarification.clarificationId],
  });

  async function proposed(): Promise<ReferralView> {
    const response = await proposeReferral(api, caseId, reviewerA, body());
    expect(response.statusCode, response.body).toBe(201);
    return response.json<ReferralView>();
  }

  const eventsOf = async (type: string) =>
    (await api.asPlatform((tx) => tx.select().from(outbox)))
      .filter((event) => event.envelope.type === type)
      .map((event) => event.envelope);

  it('S13: the assignee proposes an assets referral from the case, selecting flags and a clarification', async () => {
    const response = await proposeReferral(api, caseId, reviewerA, body());

    expect(response.statusCode, response.body).toBe(201);
    const referral = response.json<ReferralView>();
    expect(
      contractErrors(okResponse('/v1/review/cases/{caseId}/referrals', 'post', 201), referral),
    ).toEqual([]);
    expect(referral).toMatchObject({
      caseId,
      cycleYear: 2027,
      grounds: 'undeclared-assets',
      proposerKind: 'user',
      proposer: { subject: 'reviewer-a', name: 'Amina Wafula' },
      proposedAt: APPROVAL_DAY,
      status: 'proposed',
      reference: null,
      package: null,
      narrative,
      declarantName: 'James Otieno',
      personnelFileNumber: 'PSC/00042',
      sources: {
        caseIds: [caseId],
        flagIds: [registryFlag, comparisonFlag],
        clarificationIds: [clarification.clarificationId],
        obligationIds: [],
        actionIds: [ladder.actionId],
      },
    });

    // The supervisor previews what the package will include.
    const detail = await api.get(`/v1/review/referrals/${referral.id}`, supervisorS);
    expect(detail.statusCode).toBe(200);
    expect(
      contractErrors(okResponse('/v1/review/referrals/{referralId}', 'get'), detail.json()),
    ).toEqual([]);
    expect(detail.json<ReferralView>().evidence).toEqual([
      { kind: 'declaration-version', reference: 'DCB-PSC-2027-0000042-7 v1' },
      { kind: 'flag', reference: 'DCB-PSC-2027-0000042-7 registry-vehicle-undeclared' },
      { kind: 'flag', reference: 'DCB-PSC-2027-0000042-7 income-vs-asset-growth' },
      { kind: 'clarification', reference: 'CLR-PSC-2027-0000007-3' },
      { kind: 'letter', reference: 'CLR-PSC-2027-0000007-3' },
      { kind: 'letter', reference: 'ADM-PSC-2027-0000003-5' },
    ]);
    // A Confidential read, audited like a case view (ADR-008): the actor and the referral, and
    // nothing of the declarant.
    const audited = (await eventsOf('audit.read.v1')).filter(
      (audit) => (audit.data as { action: string }).action === 'review.referral.viewed',
    );
    expect(audited.map((audit) => audit.data)).toEqual([
      expect.objectContaining({
        action: 'review.referral.viewed',
        resource: expect.objectContaining({
          type: 'referral',
          params: { referralId: referral.id },
          tenant: 'psc',
        }) as unknown,
        actor: expect.objectContaining({ subject: supervisorS.sub }) as unknown,
      }),
    ]);
    expect(JSON.stringify(audited)).not.toContain('James Otieno');

    const [event] = await eventsOf(REFERRAL_PROPOSED);
    expect(event?.data).toEqual({
      referralId: referral.id,
      tenant: 'psc',
      grounds: 'undeclared-assets',
      cycleYear: 2027,
      personId: version.personId,
      proposerKind: 'user',
      proposer: 'reviewer-a',
    });
  });

  it('S13: a supervisor approves; RFL, a Confidential package with manifest hashes, referral.sent.v1, no declarant notice', async () => {
    const referral = await proposed();

    // In the inbox: the eligible supervisor may approve; the reviewer of record may not.
    const inbox = await api.get('/v1/commissions/psc/approvals?kind=referral', supervisorS);
    expect(inbox.statusCode, inbox.body).toBe(200);
    expect(
      contractErrors(okResponse('/v1/commissions/{slug}/approvals', 'get'), inbox.json()),
    ).toEqual([]);
    expect(inbox.json()).toMatchObject({
      items: [
        {
          kind: 'referral',
          subjectId: referral.id,
          proposerKind: 'user',
          canApprove: true,
          summary: { grounds: 'undeclared-assets', caseId, declarantName: 'James Otieno' },
        },
      ],
      counts: { referral: 1 },
    });
    const conflicted = await api.get('/v1/commissions/psc/approvals?kind=referral', supervisorR);
    expect(conflicted.json()).toMatchObject({
      items: [{ canApprove: false, cannotApproveReason: 'reviewer-of-record' }],
    });

    const approved = await approveReferral(api, referral.id, supervisorS);

    expect(approved.statusCode, approved.body).toBe(200);
    const body = approved.json<ReferralView>();
    expect(
      contractErrors(okResponse('/v1/review/referrals/{referralId}/approve', 'post'), body),
    ).toEqual([]);
    expect(body).toMatchObject({
      status: 'approved',
      approver: { subject: 'supervisor-s', name: 'Samuel Njoroge' },
      approvedAt: APPROVAL_DAY,
    });
    expect(body.reference).toMatch(/^RFL-PSC-2027-0000001-[0-9A-Z]$/);
    expect(parse(body.reference ?? '')).toMatchObject({
      scheme: 'RFL',
      issuer: 'PSC',
      period: 2027,
    });

    // The sending runs on Temporal: package, then sent.
    const sent = await sentReferral(api, referral.id, supervisorS);
    expect(contractErrors(okResponse('/v1/review/referrals/{referralId}', 'get'), sent)).toEqual(
      [],
    );
    expect(sent).toMatchObject({ status: 'sent', sentAt: APPROVAL_DAY, reference: body.reference });

    // The manifest: every item with its SHA-256.
    expect(sent.package?.manifest).toEqual([
      {
        kind: 'declaration-version',
        reference: 'DCB-PSC-2027-0000042-7 v1',
        sha256: digest(version.document),
        documentId: null,
      },
      {
        kind: 'declaration-attachment',
        reference: 'DCB-PSC-2027-0000042-7 v1 attachment 1',
        sha256: 'b'.repeat(64),
        documentId: attachmentId,
      },
      {
        kind: 'flag',
        reference: 'DCB-PSC-2027-0000042-7 registry-vehicle-undeclared',
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        documentId: null,
      },
      {
        kind: 'flag',
        reference: 'DCB-PSC-2027-0000042-7 income-vs-asset-growth',
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        documentId: null,
      },
      {
        kind: 'clarification',
        reference: 'CLR-PSC-2027-0000007-3',
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        documentId: null,
      },
      {
        kind: 'clarification-attachment',
        reference: 'CLR-PSC-2027-0000007-3 attachment 1',
        sha256: clarification.attachmentSha256,
        documentId: expect.any(String) as string,
      },
      {
        kind: 'letter',
        reference: 'CLR-PSC-2027-0000007-3',
        sha256: clarification.letterSha256,
        documentId: clarification.letterDocumentId,
      },
      {
        kind: 'letter',
        reference: 'ADM-PSC-2027-0000003-5',
        sha256: ladder.letterSha256,
        documentId: expect.any(String) as string,
      },
    ]);

    // One Confidential package, owned by nobody, its content pulled by referral id.
    const packages = api.documents.issued.filter(
      (issued) => issued.request.type === 'referral-package',
    );
    expect(packages).toHaveLength(1);
    const [issued] = packages;
    expect(issued?.request).toEqual({
      type: 'referral-package',
      templateVersion: 1,
      subjectRef: `referral:${referral.id}`,
      subjectPersonId: null,
      payload: { referralId: referral.id },
    });
    expect(issued?.tenant).toBe('psc');
    expect(sent.package?.documentId).toBe(issued?.document.id);
    expect(issued?.pulled.status).toBe(200);
    expect(
      contractErrors(
        okResponse('/internal/v1/review/referrals/{referralId}/package-payload', 'get'),
        issued?.pulled.body,
      ),
    ).toEqual([]);
    expect(issued?.pulled.body).toMatchObject({
      // So documents keeps the package from the officer it refers (an EACC officer, at EACC).
      declarantPersonId: version.personId,
      reference: body.reference,
      grounds: 'undeclared-assets',
      groundsLabel: 'Undeclared assets',
      declarant: { name: 'James Otieno', personnelFileNumber: 'PSC/00042' },
      narrative,
      proposedBy: 'Amina Wafula',
      approvedBy: 'Samuel Njoroge',
      manifest: sent.package?.manifest,
      versions: [{ reference: 'DCB-PSC-2027-0000042-7', version: 1, document: version.document }],
      letters: [
        { reference: 'CLR-PSC-2027-0000007-3', documentId: clarification.letterDocumentId },
        { reference: 'ADM-PSC-2027-0000003-5', documentId: expect.any(String) as string },
      ],
    });
    // Declaration content was read as the service, for the case (declarations audits it).
    expect(api.declarations.reads).toContainEqual(
      expect.objectContaining({
        declarationId: version.declarationId,
        actingSubject: 'system:review',
        caseId,
      }),
    );

    // Events: identifiers only; the reporting service reads referral.sent.v1.
    const [approvedEvent] = await eventsOf(REFERRAL_APPROVED);
    expect(approvedEvent?.data).toEqual({
      referralId: referral.id,
      tenant: 'psc',
      grounds: 'undeclared-assets',
      cycleYear: 2027,
      personId: version.personId,
      proposerKind: 'user',
      approver: 'supervisor-s',
      reference: body.reference,
    });
    const [sentEvent] = await eventsOf(REFERRAL_SENT);
    expect(sentEvent).toMatchObject({ subject: referral.id, tenant: 'psc' });
    expect(sentEvent?.data).toEqual({
      referralId: referral.id,
      tenant: 'psc',
      grounds: 'undeclared-assets',
      cycleYear: 2027,
      personId: version.personId,
      proposerKind: 'user',
      approver: 'supervisor-s',
      reference: body.reference,
      packageDocumentId: issued?.document.id,
      sentAt: APPROVAL_DAY,
    });
    for (const event of [...(await eventsOf(REFERRAL_PROPOSED)), approvedEvent, sentEvent]) {
      const text = JSON.stringify(event);
      for (const secret of ['James Otieno', 'PSC/00042', narrative, 'b'.repeat(64)]) {
        expect(text).not.toContain(secret);
      }
    }

    // The declarant is told nothing, and cannot see it.
    expect(api.notifications.sent).toEqual([]);
    expect((await api.get(`/v1/review/referrals/${referral.id}`, declarant)).statusCode).toBe(404);

    // Workflow history: ids, counts and outcomes only.
    const history = await historyPayloads(temporalOf(api), referralSendingWorkflowId(referral.id));
    expect(history).toContain(referral.id);
    for (const secret of [
      'James Otieno',
      'PSC/00042',
      body.reference ?? '',
      'DCB-PSC-2027-0000042-7',
      'CLR-PSC-2027-0000007-3',
      narrative,
      digest(version.document),
      clarification.letterSha256,
    ]) {
      expect(history).not.toContain(secret);
    }

    // Out of the inbox, and decided.
    const after = await api.get('/v1/commissions/psc/approvals?kind=referral', supervisorS);
    expect(after.json()).toMatchObject({ items: [], counts: { referral: 0 } });
    expect((await approveReferral(api, referral.id, supervisorS)).statusCode).toBe(409);
  });

  it('declines with a note: nothing allocated, packaged or sent', async () => {
    const referral = await proposed();

    const declined = await declineReferral(
      api,
      referral.id,
      supervisorS,
      'The flags are explained by the response.',
    );

    expect(declined.statusCode, declined.body).toBe(200);
    const body = declined.json<ReferralView>();
    expect(
      contractErrors(okResponse('/v1/review/referrals/{referralId}/decline', 'post'), body),
    ).toEqual([]);
    expect(body).toMatchObject({
      status: 'declined',
      declinedBy: { subject: 'supervisor-s', name: 'Samuel Njoroge' },
      declinedAt: APPROVAL_DAY,
      declineNote: 'The flags are explained by the response.',
      reference: null,
      package: null,
    });
    const [event] = await eventsOf(REFERRAL_DECLINED);
    expect(event?.data).toEqual({
      referralId: referral.id,
      tenant: 'psc',
      grounds: 'undeclared-assets',
      cycleYear: 2027,
      personId: version.personId,
      proposerKind: 'user',
      declinedBy: 'supervisor-s',
    });
    expect(JSON.stringify(event)).not.toContain('explained');
    expect(api.documents.issued).toEqual([]);
    expect(await eventsOf(REFERRAL_SENT)).toEqual([]);
    expect((await approveReferral(api, referral.id, supervisorS)).statusCode).toBe(409);
    expect((await declineReferral(api, referral.id, supervisorS, 'again')).statusCode).toBe(409);
  });

  it('refuses flags that are not registry or comparison flags of the case, drafts, and a second open proposal', async () => {
    const late = await proposeReferral(api, caseId, reviewerA, { ...body(), flagIds: [lateFlag] });
    expect(late.statusCode).toBe(400);
    const none = await proposeReferral(api, caseId, reviewerA, { ...body(), flagIds: [] });
    expect(none.statusCode).toBe(400);
    const draft = await givenIssuedClarification(api, {
      tenant: 'psc',
      caseId,
      personId: version.personId,
      reference: 'unused',
      status: 'draft',
    });
    const drafted = await proposeReferral(api, caseId, reviewerA, {
      ...body(),
      clarificationIds: [draft.clarificationId],
    });
    expect(drafted.statusCode).toBe(400);
    const unknown = await proposeReferral(api, caseId, reviewerA, {
      ...body(),
      flagIds: [randomUUID()],
    });
    expect(unknown.statusCode).toBe(400);
    const selfExplaining = await proposeReferral(api, caseId, reviewerA, {
      ...body(),
      grounds: 'two-missed-cycles',
    });
    expect(selfExplaining.statusCode).toBe(400);

    await proposed();
    const again = await proposeReferral(api, caseId, reviewerA, body());
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'referral-open' });
    expect(await referralRows(api)).toHaveLength(1);
  });

  describe('authorisation', () => {
    it('propose: the assignee only; others of the Commission 403, anyone else 404', async () => {
      const notAssignee = await proposeReferral(api, caseId, reviewerB, body());
      expect(notAssignee.statusCode).toBe(403);
      expect(notAssignee.json()).toMatchObject({ type: 'not-the-assignee' });
      const supervisorNotAssignee = await proposeReferral(api, caseId, supervisorS, body());
      expect(supervisorNotAssignee.statusCode).toBe(403);
      for (const caller of [tscReviewer, tscSupervisor, helpdesk, declarant]) {
        expect((await proposeReferral(api, caseId, caller, body())).statusCode).toBe(404);
      }
      expect(await referralRows(api)).toEqual([]);
    });

    it('propose: a supervisor holding the case proposes like a reviewer', async () => {
      const held = submittedVersion({
        tenant: 'psc',
        document: declaration([statement('officer', { assets: [asset()] })]),
      });
      api.declarations.given(held);
      const heldCase = await givenWorkedCase(api, held, [supervisorS]);
      const flag = await givenFlag(
        api,
        'psc',
        heldCase,
        held.versionId,
        'declared-parcel-not-found',
      );

      const response = await proposeReferral(api, heldCase, supervisorS, {
        grounds: 'unexplained-assets',
        narrative,
        flagIds: [flag],
        clarificationIds: [],
      });

      expect(response.statusCode, response.body).toBe(201);
    });

    it('approve and decline: a supervisor who neither proposed it nor held the case', async () => {
      const referral = await proposed();

      const cases: [Caller, number, string | undefined][] = [
        [reviewerA, 403, 'separation-of-duties'],
        [reviewerB, 403, 'supervisor-required'],
        [supervisorR, 403, 'separation-of-duties'],
        [tscSupervisor, 404, undefined],
        [helpdesk, 404, undefined],
        [declarant, 404, undefined],
      ];
      for (const [caller, status, type] of cases) {
        const approve = await approveReferral(api, referral.id, caller);
        expect(approve.statusCode, `${caller.sub ?? ''} approve`).toBe(status);
        const decline = await declineReferral(api, referral.id, caller, 'No.');
        expect(decline.statusCode, `${caller.sub ?? ''} decline`).toBe(status);
        if (type !== undefined) expect(approve.json()).toMatchObject({ type });
      }
      expect((await referralRows(api))[0]?.status).toBe('proposed');
      expect(await eventsOf(REFERRAL_APPROVED)).toEqual([]);
    });

    it('view: the Commission review staff; anyone else 404', async () => {
      const referral = await proposed();

      for (const caller of [reviewerA, reviewerB, supervisorS]) {
        const list = await api.get('/v1/commissions/psc/referrals', caller);
        expect(list.statusCode).toBe(200);
        expect(
          contractErrors(okResponse('/v1/commissions/{slug}/referrals', 'get'), list.json()),
        ).toEqual([]);
        expect(list.json()).toMatchObject({ items: [{ id: referral.id }], nextCursor: null });
        expect((await api.get(`/v1/review/referrals/${referral.id}`, caller)).statusCode).toBe(200);
      }
      const filtered = await api.get('/v1/commissions/psc/referrals?status=sent', reviewerA);
      expect(filtered.json()).toMatchObject({ items: [] });
      for (const caller of [tscReviewer, helpdesk, declarant]) {
        expect((await api.get('/v1/commissions/psc/referrals', caller)).statusCode).toBe(404);
        expect((await api.get(`/v1/review/referrals/${referral.id}`, caller)).statusCode).toBe(404);
      }
      // The inbox is the supervisors'.
      expect((await api.get('/v1/commissions/psc/approvals', reviewerB)).statusCode).toBe(403);
    });
  });
});
