import { randomUUID } from 'node:crypto';

import { REVIEWER } from '@adili/roles';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { accessRequests } from '../../src/db/schema.js';
import type { DisclosureDocument } from '../../src/declarations/declarations-client.js';
import type { RosterCandidateFacts } from '../../src/directory/directory-client.js';
import { accessRequestWorkflowId } from '../../src/requests/contract.js';
import { DecisionActivities } from '../../src/requests/decision-activities.js';
import type { OfficerRequestView } from '../../src/requests/officer-view.js';
import type { AccessRequest } from '../../src/requests/representation.js';
import type { DisclosedClarification } from '../../src/review/review-client.js';
import type { Scope } from '../../src/scope.js';
import { type AccessApi, type Caller, startAccessApi } from '../support/access-api.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  callers,
  decide,
  declarantOf,
  givenCommissions,
  notifiedRequest,
  rowOf,
  underDecisionRequest,
} from '../support/requests.js';

const NOW = '2027-03-04T09:00:00.000Z';
/** Decided on 20 March, 15:00 in Nairobi. */
const DECIDED_AT = '2027-03-20T12:00:00.000Z';
/** Issued at once: downloadable for 14 days, to 3 April 15:00 in Nairobi. */
const EXPIRES_AT = '2027-04-03T12:00:00.000Z';

const REQUESTED: Scope = {
  years: [2025, 2026],
  includeSpouses: true,
  includeChildren: false,
  sections: ['income', 'assets', 'liabilities'],
  includeClarifications: true,
};

/** Narrowed: 2026 only, the officer's own statement, assets and liabilities. */
const NARROWED: Scope = {
  years: [2026],
  includeSpouses: false,
  includeChildren: false,
  sections: ['assets', 'liabilities'],
  includeClarifications: false,
};

const REASONS = 'The applicant shows a legitimate interest in the officer’s land holdings.';

/** A clarification of the disclosed 2026 declaration, as review discloses it. */
const CLARIFICATION: DisclosedClarification = {
  declarationReference: 'DCB-PSC-2026-0000001-1',
  reference: 'CLR-PSC-2027-0000004-6',
  status: 'responded',
  issuedAt: '2027-02-01T09:00:00.000Z',
  dueAt: '2027-03-03T09:00:00.000Z',
  respondedAt: '2027-02-20T09:00:00.000Z',
  responseLate: false,
  resolvedAt: null,
  items: [
    {
      label: 'Assets · Plot LR 209/1234 · Anne Njeri Mutua',
      requirementLabel: 'Explain the discrepancy or inconsistency',
      text: 'Explain the value of the plot.',
      response: { text: 'It was revalued in 2026.', attachmentNames: ['valuation.pdf'] },
    },
  ],
};

function disclosureOf(reference: string): DisclosureDocument {
  return {
    schemaVersion: 'disclosure.v1',
    grantReference: reference,
    personName: 'Anne Njeri Mutua',
    commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
    versions: [
      {
        reference: 'DCB-PSC-2026-0000001-1',
        version: 1,
        type: 'biennial',
        statementDate: '2026-12-31',
        submittedAt: '2027-01-15T08:00:00.000Z',
        content: { schemaVersion: 'declaration.v1', type: 'biennial', statementDate: '2026-12-31' },
      },
    ],
  };
}

/**
 * The access officer's decision (S6) through the HTTP interface, with `AccessRequestWorkflow`
 * carrying it out on the compose Temporal: the outcome rules, the scoped disclosure asked of
 * declarations, the package issued by documents, both parties told, the register and events.
 */
describe('Deciding an access request (S6)', () => {
  let api: AccessApi;
  const { mercy, officer, supervisor, tscOfficer, eacc } = callers;

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  async function underDecision(): Promise<{
    anne: RosterCandidateFacts;
    id: string;
    reference: string;
  }> {
    const { anne } = givenCommissions(api, NOW);
    const row = await underDecisionRequest(api, anne);
    api.declarations.givenDisclosure(anne.personId ?? '', disclosureOf(row.reference));
    api.clock.set(DECIDED_AT);
    return { anne, id: row.id, reference: row.reference };
  }

  /** Waits until the workflow has recorded the request's package. */
  const untilPackaged = (id: string) =>
    api.eventually(async () => {
      const row = await rowOf(api, id);
      return row.packageDocumentId === null ? undefined : row;
    });

  /** Waits until every message of `templates` went out, and returns them. */
  const untilSent = (...templates: string[]) =>
    api.eventually(() =>
      templates.every((template) => api.notifications.sent.some((m) => m.template === template))
        ? api.notifications.sent
        : undefined,
    );

  describe('grants', () => {
    it('S6: a partial grant asks declarations for exactly the granted scope and has documents issue the watermarked Confidential package; both parties told', async () => {
      const { anne, id, reference } = await underDecision();

      const response = await decide(api, id, {
        outcome: 'partial-grant',
        grantedScope: NARROWED,
        grounds: ['public-interest'],
        reasons: REASONS,
      });

      expect(response.statusCode, response.body).toBe(200);
      const view = response.json<OfficerRequestView>();
      expect(
        contractErrors(okResponse('/v1/access/requests/{requestId}/decision', 'post'), view),
      ).toEqual([]);
      expect(view).toMatchObject({
        status: 'partially-granted',
        decision: {
          outcome: 'partial-grant',
          grantedScope: NARROWED,
          grounds: ['public-interest'],
          reasons: REASONS,
          decidedBy: { subject: officer.sub, name: officer.name },
          decidedAt: DECIDED_AT,
        },
        package: null,
      });

      const row = await untilPackaged(id);
      expect(api.declarations.disclosureCalls).toEqual([
        {
          personId: anne.personId,
          tenant: 'psc',
          officerSubject: officer.sub,
          grantReference: reference,
          legalBasis: 'act-s36-1',
          recipientSubject: mercy.sub,
          years: [2026],
          includeSpouses: false,
          includeChildren: false,
          sections: ['assets', 'liabilities'],
        },
      ]);
      // The narrowed grant leaves the clarifications out: review is not asked.
      expect(api.review.calls).toEqual([]);
      expect(api.documents.issued).toEqual([
        {
          tenant: 'psc',
          type: 'access-package',
          templateVersion: 1,
          subjectRef: `access-request:${id}`,
          subjectPersonId: mercy.personId,
          payload: {
            disclosure: disclosureOf(reference),
            legalBasis: 'act-s36-1',
            recipient: { name: 'Mercy Wanjiku Kamau', organisation: null },
            grantedAt: DECIDED_AT,
            scope: {
              years: [2026],
              includeSpouses: false,
              includeChildren: false,
              sections: ['assets', 'liabilities'],
              includeClarifications: false,
            },
            clarifications: null,
          },
          watermark: { recipientName: 'Mercy Wanjiku Kamau', reference, date: '2027-03-20' },
          downloadWindowDays: 14,
          // The package is in force for its download window (ADR-010).
          validUntil: EXPIRES_AT,
          idempotencyKey: expect.any(String) as unknown,
        },
      ]);
      expect(row).toMatchObject({
        packageVerificationId: 'ADL-TEST-1',
        packageIssuedAt: new Date(DECIDED_AT),
        downloadExpiresAt: new Date(EXPIRES_AT),
      });

      const sent = await untilSent('access-package-ready-email', 'access-package-ready-sms');
      const decisionMessages = sent.filter((m) => m.template.startsWith('access-decision-'));
      expect(decisionMessages.map((m) => [m.template, m.recipient, m.params.outcome])).toEqual([
        [
          'access-decision-applicant-email',
          { kind: 'person', personId: mercy.personId },
          'partially-granted',
        ],
        [
          'access-decision-applicant-sms',
          { kind: 'person', personId: mercy.personId },
          'partially-granted',
        ],
        [
          'access-decision-declarant-email',
          { kind: 'person', personId: anne.personId },
          'partially-granted',
        ],
        [
          'access-decision-declarant-sms',
          { kind: 'person', personId: anne.personId },
          'partially-granted',
        ],
      ]);
      expect(sent.find((m) => m.template === 'access-package-ready-email')).toEqual({
        channel: 'email',
        recipient: { kind: 'person', personId: mercy.personId },
        template: 'access-package-ready-email',
        params: {
          reference,
          commissionName: 'Public Service Commission',
          downloadUntil: '2027-04-03',
          signInUrl: 'http://localhost:3010/access/requests',
        },
        tenant: 'psc',
        idempotencyKey: expect.any(String) as unknown,
      });

      // The register and its events: the decision with outcome and grounds (Form M section 5),
      // then the package.
      const [decided] = await api.events('access.request.decided.v1');
      expect(decided).toMatchObject({
        tenant: 'psc',
        subject: id,
        data: {
          kind: 'decided',
          legalBasis: 'act-s36-1',
          personId: anne.personId,
          actor: officer.sub,
          outcome: 'partial-grant',
          grounds: ['public-interest'],
          at: DECIDED_AT,
        },
      });
      const [issued] = await api.events('access.request.package-issued.v1');
      expect(issued?.data).toMatchObject({
        kind: 'package-issued',
        actor: null,
        documentId: row.packageDocumentId,
        downloadExpiresAt: EXPIRES_AT,
      });
      expect(JSON.stringify([decided, issued])).not.toContain(REASONS);

      // The applicant sees the decision and the package to download from documents.
      const mine = await api.get(`/v1/access/requests/${id}`, mercy);
      expect(mine.statusCode, mine.body).toBe(200);
      const request = mine.json<AccessRequest>();
      expect(contractErrors(okResponse('/v1/access/requests/{requestId}', 'get'), request)).toEqual(
        [],
      );
      expect(request.package).toEqual({
        kind: 'access-package',
        documentId: row.packageDocumentId,
        verificationId: 'ADL-TEST-1',
        issuedAt: DECIDED_AT,
        downloadExpiresAt: EXPIRES_AT,
        downloads: 0,
      });
      expect(request.timeline.map((entry) => entry.kind)).toEqual([
        'received',
        'identified',
        'notified',
        'decided',
        'package-issued',
      ]);
      const forOfficer = await api.get(`/v1/access/requests/${id}/officer`, officer);
      expect(forOfficer.json<OfficerRequestView>().package).toEqual(request.package);
    });

    it('S6: a grant is of the requested scope, with no grounds, and its package carries the clarifications review discloses for it', async () => {
      const { anne, id, reference } = await underDecision();
      api.review.givenClarifications(anne.personId ?? '', [
        CLARIFICATION,
        // Of a declaration the grant did not disclose: never asked for, never packaged.
        { ...CLARIFICATION, declarationReference: 'DCB-PSC-2024-0000007-2' },
      ]);

      const response = await decide(api, id, { outcome: 'grant', reasons: REASONS });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<OfficerRequestView>()).toMatchObject({
        status: 'granted',
        decision: { outcome: 'grant', grantedScope: REQUESTED, grounds: [] },
      });
      await untilPackaged(id);
      expect(api.declarations.disclosureCalls[0]).toMatchObject({
        years: [2025, 2026],
        includeSpouses: true,
        includeChildren: false,
        sections: ['income', 'assets', 'liabilities'],
      });
      // Declarations has no clarifications: the grant's scope is never sent with them.
      expect(api.declarations.disclosureCalls[0]).not.toHaveProperty('includeClarifications');
      expect(api.review.calls).toEqual([
        {
          personId: anne.personId,
          tenant: 'psc',
          officerSubject: officer.sub,
          grantReference: reference,
          legalBasis: 'act-s36-1',
          recipientSubject: mercy.sub,
          declarationReferences: ['DCB-PSC-2026-0000001-1'],
          includeSpouses: true,
          includeChildren: false,
          sections: ['income', 'assets', 'liabilities'],
        },
      ]);
      expect(api.documents.issued[0]?.payload).toMatchObject({
        scope: { includeClarifications: true },
        clarifications: [CLARIFICATION],
      });
      const [decided] = await api.events('access.request.decided.v1');
      expect(decided?.data).toMatchObject({ outcome: 'grant', grounds: [] });
    });

    it('an issue attempt that lost the race to record its package answers with the one recorded', async () => {
      const { id } = await underDecision();
      await api.endWorkflows([accessRequestWorkflowId(id)]);
      const decided = await decide(api, id, { outcome: 'grant', reasons: REASONS });
      expect(decided.statusCode, decided.body).toBe(200);
      const recordedExpiry = new Date('2027-04-02T12:00:00.000Z');
      const issue = api.documents.issue.bind(api.documents);
      const spy = vi.spyOn(api.documents, 'issue').mockImplementation(async (request) => {
        const issued = await issue(request);
        // Meanwhile another attempt of the activity records its package first.
        await api.asPlatform((tx) =>
          tx
            .update(accessRequests)
            .set({
              packageKind: 'access-package',
              packageDocumentId: randomUUID(),
              packageVerificationId: 'ADL-OTHER',
              packageIssuedAt: new Date('2027-03-19T12:00:00.000Z'),
              downloadExpiresAt: recordedExpiry,
            })
            .where(eq(accessRequests.id, id)),
        );
        return issued;
      });

      try {
        const outcome = await api.app.get(DecisionActivities).issuePackage({
          tenant: 'psc',
          requestId: id,
          submittedAt: NOW,
          transactionId: '0',
        });

        expect(outcome).toEqual({
          outcome: 'issued',
          downloadExpiresAt: recordedExpiry.toISOString(),
        });
      } finally {
        spy.mockRestore();
      }
    });

    it('S6: a partial grant wider than the request is 400 scope-exceeds-request; without grounds 400 grounds-required', async () => {
      const { id } = await underDecision();

      const wider = await decide(api, id, {
        outcome: 'partial-grant',
        grantedScope: { ...NARROWED, sections: ['bio'] },
        grounds: ['public-interest'],
        reasons: REASONS,
      });
      const groundless = await decide(api, id, {
        outcome: 'partial-grant',
        grantedScope: NARROWED,
        reasons: REASONS,
      });

      expect(wider.statusCode).toBe(400);
      expect(wider.json()).toMatchObject({
        code: 'scope-exceeds-request',
        errors: [{ path: 'grantedScope' }],
      });
      expect(groundless.statusCode).toBe(400);
      expect(groundless.json()).toMatchObject({
        code: 'grounds-required',
        errors: [{ path: 'grounds' }],
      });
      expect((await rowOf(api, id)).status).toBe('under-decision');
    });
  });

  describe('denials', () => {
    it('S6: deny without grounds is 400; with frivolous-vexatious the request is denied and both parties told, with nothing disclosed', async () => {
      const { id } = await underDecision();

      const groundless = await decide(api, id, { outcome: 'deny', reasons: REASONS });
      expect(groundless.statusCode).toBe(400);
      expect(groundless.json()).toMatchObject({ code: 'grounds-required' });

      const response = await decide(api, id, {
        outcome: 'deny',
        grounds: ['frivolous-vexatious'],
        reasons: REASONS,
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<OfficerRequestView>()).toMatchObject({
        status: 'denied',
        decision: { outcome: 'deny', grantedScope: null, grounds: ['frivolous-vexatious'] },
      });
      const sent = await untilSent(
        'access-decision-applicant-email',
        'access-decision-applicant-sms',
        'access-decision-declarant-email',
        'access-decision-declarant-sms',
      );
      expect(
        sent.filter((m) => m.template.startsWith('access-decision-')).map((m) => m.params.outcome),
      ).toEqual(['denied', 'denied', 'denied', 'denied']);
      const [decided] = await api.events('access.request.decided.v1');
      expect(decided?.data).toMatchObject({ outcome: 'deny', grounds: ['frivolous-vexatious'] });
      // The run ends after the notices: nothing is disclosed or issued.
      await api.eventually(async () => {
        const handle = api.temporal.workflow.getHandle(`access-request:${id}`);
        return (await handle.describe()).status.name === 'COMPLETED';
      });
      expect(api.declarations.disclosureCalls).toEqual([]);
      expect(api.documents.issued).toEqual([]);
    });

    it("tells the applicant and the declarant the decision, never which of the Commission's staff took it", async () => {
      const { anne, id } = await underDecision();
      const response = await decide(api, id, {
        outcome: 'deny',
        grounds: ['frivolous-vexatious'],
        reasons: REASONS,
      });
      expect(response.statusCode, response.body).toBe(200);
      const told = {
        outcome: 'deny',
        grantedScope: null,
        grounds: ['frivolous-vexatious'],
        reasons: REASONS,
        decidedAt: DECIDED_AT,
      };

      const mine = await api.get(`/v1/access/requests/${id}`, mercy);
      expect(mine.statusCode, mine.body).toBe(200);
      expect(
        contractErrors(okResponse('/v1/access/requests/{requestId}', 'get'), mine.json()),
      ).toEqual([]);
      expect(mine.json<AccessRequest>().decision).toEqual(told);

      const notices = await api.get('/v1/me/access-notices', declarantOf(anne));
      expect(notices.statusCode, notices.body).toBe(200);
      expect(contractErrors(okResponse('/v1/me/access-notices', 'get'), notices.json())).toEqual(
        [],
      );
      expect(notices.json<{ decision: unknown }[]>()[0]?.decision).toEqual(told);

      for (const body of [mine.body, notices.body]) {
        expect(body).not.toContain(officer.sub);
        expect(body).not.toContain(officer.name);
      }
    });
  });

  describe('finality and authorisation', () => {
    it('S6: a second decision is 409 request-decided', async () => {
      const { id } = await underDecision();
      const first = await decide(api, id, {
        outcome: 'deny',
        grounds: ['not-objectives'],
        reasons: REASONS,
      });
      expect(first.statusCode, first.body).toBe(200);

      const second = await decide(api, id, { outcome: 'grant', reasons: REASONS });

      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({ code: 'request-decided' });
      expect((await rowOf(api, id)).status).toBe('denied');
      expect(await api.events('access.request.decided.v1')).toHaveLength(1);
    });

    it('a request whose window is still open is 409 not-under-decision; a withdrawn one 409 request-closed', async () => {
      const { anne } = givenCommissions(api, NOW);
      const row = await notifiedRequest(api, anne);

      const open = await decide(api, row.id, { outcome: 'grant', reasons: REASONS });
      expect(open.statusCode).toBe(409);
      expect(open.json()).toMatchObject({ code: 'not-under-decision' });

      const withdrawn = await api.send('POST', `/v1/access/requests/${row.id}/withdraw`, mercy);
      expect(withdrawn.statusCode, withdrawn.body).toBe(200);
      const closed = await decide(api, row.id, { outcome: 'grant', reasons: REASONS });
      expect(closed.statusCode).toBe(409);
      expect(closed.json()).toMatchObject({ code: 'request-closed' });
    });

    it.each<[string, Caller, number]>([
      ['a reviewer', { sub: 'reviewer-psc', roles: [REVIEWER], tenant: 'psc' }, 403],
      ['the supervisor', supervisor, 403],
      ["another Commission's access officer", tscOfficer, 404],
      ['EACC', eacc, 404],
      ['the applicant', mercy, 403],
    ])('S16: %s cannot decide (%i)', async (_, caller, status) => {
      const { id } = await underDecision();

      const response = await decide(api, id, { outcome: 'grant', reasons: REASONS }, caller);

      expect(response.statusCode, response.body).toBe(status);
      expect((await rowOf(api, id)).status).toBe('under-decision');
    });

    it('requires an Idempotency-Key, and a strict body', async () => {
      const { id } = await underDecision();

      const keyless = await api.send('POST', `/v1/access/requests/${id}/decision`, officer, {
        outcome: 'grant',
        reasons: REASONS,
      });
      const extra = await decide(api, id, { outcome: 'grant', reasons: REASONS, note: 'x' });
      const unknown = await decide(api, randomUUID(), { outcome: 'grant', reasons: REASONS });

      expect(keyless.statusCode).toBe(400);
      expect(extra.statusCode).toBe(400);
      expect(unknown.statusCode).toBe(404);
    });
  });
});
