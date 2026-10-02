import { randomUUID } from 'node:crypto';

import { DECLARANT, REVIEWER } from '@adili/roles';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { accessRequests } from '../../src/db/schema.js';
import type { RosterCandidateFacts } from '../../src/directory/directory-client.js';
import type { ScopePreview } from '../../src/preview/representation.js';
import { type AccessApi, type Caller, startAccessApi } from '../support/access-api.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { givenLeaOfficers, LEA_INPUT, leaCallers, submitLea, verifyLea } from '../support/lea.js';
import {
  callers,
  decide,
  declarantOf,
  givenCommissions,
  resolve,
  submitRequest,
  underDecisionRequest,
} from '../support/requests.js';

const NOW = '2027-03-04T09:00:00.000Z';

/**
 * Spec 10 decision 1: before deciding, the access officer (or, reading, the supervisor) sees
 * what the requested scope, or a narrower one, holds of the declarant's declarations, in counts
 * per year, section and household member kind, with the clarifications: never content, audited
 * with its legal basis. Declarations and review count (their side of it is tested there); here,
 * that the access service asks them for exactly the scope, adds up their counts and guards who
 * may see them (S16).
 */
describe('The scope preview before the decision (decision 1)', () => {
  let api: AccessApi;
  let anne: RosterCandidateFacts;
  const { mercy, officer, supervisor, tscOfficer, eacc } = callers;
  const reviewer: Caller = { sub: 'reviewer-psc', roles: [REVIEWER], tenant: 'psc' };

  const D2025 = 'DCB-PSC-2025-0000007-1';

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  /** Anne has one declaration in 2025 (none in 2026), with one clarification issued on it. */
  function givenAnnesDeclarations(): void {
    api.declarations.givenCounts(anne.personId ?? '', [
      {
        year: 2025,
        declarations: 1,
        declarationReferences: [D2025],
        sections: { income: 3, assets: 2, liabilities: 1, bio: 2 },
        spouses: 1,
        children: 2,
      },
    ]);
    api.review.givenClarifications(anne.personId ?? '', [
      {
        declarationReference: D2025,
        reference: 'CLR-PSC-2026-0000001-3',
        status: 'responded',
        issuedAt: '2026-02-01T09:00:00.000Z',
        dueAt: '2026-03-03T09:00:00.000Z',
        respondedAt: '2026-02-20T09:00:00.000Z',
        responseLate: false,
        resolvedAt: null,
        items: [],
      },
    ]);
  }

  async function formKUnderDecision(): Promise<string> {
    ({ anne } = givenCommissions(api, NOW));
    return (await underDecisionRequest(api, anne)).id;
  }

  const preview = (id: string, caller: Caller = officer) =>
    api.get(`/v1/access/requests/${id}/preview`, caller);
  const previewScope = (id: string, scope: unknown, caller: Caller = officer) =>
    api.send('POST', `/v1/access/requests/${id}/preview`, caller, scope);

  const REQUESTED = {
    years: [2025, 2026],
    includeSpouses: true,
    includeChildren: false,
    sections: ['income', 'assets', 'liabilities'],
    includeClarifications: true,
  };

  describe('Form K', () => {
    it('counts the requested scope per year, section and household member kind, with its clarifications', async () => {
      const id = await formKUnderDecision();
      givenAnnesDeclarations();

      const response = await preview(id);

      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<ScopePreview>();
      expect(
        contractErrors(okResponse('/v1/access/requests/{requestId}/preview', 'get'), body),
      ).toEqual([]);
      expect(body).toEqual({
        scope: REQUESTED,
        declarantOnboarded: true,
        empty: false,
        declarations: 1,
        clarifications: 1,
        years: [
          {
            year: 2025,
            declarations: 1,
            // Only the requested sections and household members: no bio, no children.
            sections: { income: 3, assets: 2, liabilities: 1 },
            spouses: 1,
            children: null,
            clarifications: 1,
          },
          {
            year: 2026,
            declarations: 0,
            sections: { income: 0, assets: 0, liabilities: 0 },
            spouses: 0,
            children: null,
            clarifications: 0,
          },
        ],
      });
      // Counts only: no reference, name or content leaves.
      expect(response.body).not.toContain(D2025);
      expect(response.body).not.toContain('CLR-');
      const { reference } = (
        await api.asPlatform((tx) =>
          tx.select().from(accessRequests).where(eq(accessRequests.id, id)),
        )
      )[0] ?? { reference: '' };
      expect(api.declarations.countCalls).toEqual([
        {
          personId: anne.personId,
          tenant: 'psc',
          viewerSubject: officer.sub,
          grantReference: reference,
          legalBasis: 'act-s36-1',
          years: [2025, 2026],
          includeSpouses: true,
          includeChildren: false,
          sections: ['income', 'assets', 'liabilities'],
        },
      ]);
      expect(api.review.countCalls).toMatchObject([
        { declarationReferences: [D2025], viewerSubject: officer.sub, legalBasis: 'act-s36-1' },
      ]);
    });

    it('counts a narrower scope the officer weighs, and refuses a wider one', async () => {
      const id = await formKUnderDecision();
      givenAnnesDeclarations();
      const narrower = {
        years: [2025],
        includeSpouses: false,
        includeChildren: false,
        sections: ['assets'],
        includeClarifications: false,
      };

      const response = await previewScope(id, narrower);

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<ScopePreview>()).toMatchObject({
        scope: narrower,
        clarifications: null,
        years: [{ year: 2025, sections: { assets: 2 }, spouses: null, clarifications: null }],
      });
      expect(api.declarations.countCalls.at(-1)).toMatchObject({
        years: [2025],
        sections: ['assets'],
        includeSpouses: false,
      });
      // No clarifications in the scope: review is not asked.
      expect(api.review.countCalls).toEqual([]);

      const wider = await previewScope(id, { ...narrower, includeChildren: true });
      expect(wider.statusCode).toBe(400);
      expect(wider.json()).toMatchObject({ code: 'scope-exceeds-request' });
      const invalid = await previewScope(id, { ...narrower, sections: [] });
      expect(invalid.statusCode).toBe(400);
    });

    it('an empty scope says so: a grant of it issues the nil letter', async () => {
      const id = await formKUnderDecision();

      const body = (await preview(id)).json<ScopePreview>();

      expect(body).toMatchObject({ empty: true, declarantOnboarded: true, declarations: 0 });
      expect(body.years.map((year) => year.declarations)).toEqual([0, 0]);
      // Nothing to count clarifications on.
      expect(api.review.countCalls).toEqual([]);
    });

    it('a declarant with no account (served in writing) holds nothing: declarations is not asked', async () => {
      const id = await formKUnderDecision();
      await api.asPlatform((tx) =>
        tx.update(accessRequests).set({ resolvedPersonId: null }).where(eq(accessRequests.id, id)),
      );

      const response = await preview(id);

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<ScopePreview>()).toMatchObject({
        empty: true,
        declarantOnboarded: false,
        declarations: 0,
        clarifications: 0,
      });
      expect(api.declarations.countCalls).toEqual([]);
    });

    it('is audited with the legal basis, the reference and the officer as recipient', async () => {
      const id = await formKUnderDecision();
      givenAnnesDeclarations();
      const before = (await api.events('audit.read.v1')).length;

      expect((await preview(id)).statusCode).toBe(200);

      const audits = (await api.events('audit.read.v1')).slice(before);
      expect(audits).toEqual([
        expect.objectContaining({
          tenant: 'psc',
          data: expect.objectContaining({
            action: 'access.scope.previewed',
            resource: expect.objectContaining({
              type: 'access-request',
              tenant: 'psc',
              subjectPersonId: anne.personId,
            }) as unknown,
            legalBasis: { basis: 'act-s36-1', reference: expect.any(String) as unknown },
            recipient: officer.sub,
          }) as unknown,
        }),
      ]);
    });

    it('S16: the access officer and the supervisor see it; others get 403 or 404', async () => {
      const id = await formKUnderDecision();
      givenAnnesDeclarations();

      expect((await preview(id, officer)).statusCode).toBe(200);
      expect((await preview(id, supervisor)).statusCode).toBe(200);
      expect((await previewScope(id, REQUESTED, supervisor)).statusCode).toBe(200);
      for (const outsider of [tscOfficer, eacc]) {
        expect((await preview(id, outsider)).statusCode).toBe(404);
      }
      const declarant: Caller = { ...declarantOf(anne), roles: [DECLARANT] };
      for (const forbidden of [mercy, declarant, reviewer, leaCallers.peter]) {
        expect((await preview(id, forbidden)).statusCode).toBe(403);
        expect((await previewScope(id, REQUESTED, forbidden)).statusCode).toBe(403);
      }
      expect((await preview(randomUUID())).statusCode).toBe(404);
    });

    it('409 before the officer named is identified, and once decided', async () => {
      ({ anne } = givenCommissions(api, NOW));
      const { id: unresolved } = await submitRequest(api);
      const early = await preview(unresolved);
      expect(early.statusCode).toBe(409);
      expect(early.json()).toMatchObject({ code: 'not-under-decision' });

      // Resolved, the declarant notified, the window still open: the officer may look ahead.
      expect((await resolve(api, unresolved, anne.id)).statusCode).toBe(200);
      expect((await preview(unresolved)).statusCode).toBe(200);

      const id = await formKUnderDecision();
      expect((await decide(api, id, { outcome: 'grant', reasons: 'Shown.' })).statusCode).toBe(200);
      const decided = await preview(id);
      expect(decided.statusCode).toBe(409);
      expect(decided.json()).toMatchObject({ code: 'request-decided' });
    });

    it('503 when declarations cannot be reached', async () => {
      const id = await formKUnderDecision();
      api.declarations.failCalls(1, 'countDisclosure');

      const response = await preview(id);

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ type: 'declarations-unavailable' });
    });
  });

  describe('law enforcement', () => {
    const leaPreview = (id: string, caller: Caller = officer) =>
      api.get(`/v1/lea/requests/${id}/preview`, caller);

    async function verified(): Promise<string> {
      ({ anne } = givenCommissions(api, NOW));
      givenLeaOfficers(api);
      const { id } = await submitLea(api);
      const response = await verifyLea(api, id, anne.id);
      expect(response.statusCode, response.body).toBe(200);
      return id;
    }

    it('counts a verified request under s.36(2), never with clarifications', async () => {
      const id = await verified();
      givenAnnesDeclarations();

      const response = await leaPreview(id);

      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<ScopePreview>();
      expect(
        contractErrors(okResponse('/v1/lea/requests/{leaRequestId}/preview', 'get'), body),
      ).toEqual([]);
      expect(body).toMatchObject({
        scope: LEA_INPUT.scope,
        empty: true,
        clarifications: null,
        years: [{ year: 2026, sections: { income: 0, assets: 0 }, spouses: 0 }],
      });
      expect(api.declarations.countCalls).toMatchObject([
        { legalBasis: 'act-s36-2', years: [2026], viewerSubject: officer.sub },
      ]);
      expect(api.review.countCalls).toEqual([]);

      const withClarifications = await api.send('POST', `/v1/lea/requests/${id}/preview`, officer, {
        ...LEA_INPUT.scope,
        includeClarifications: true,
      });
      expect(withClarifications.statusCode).toBe(400);
      expect(withClarifications.json()).toMatchObject({ code: 'scope-exceeds-request' });
    });

    it("409 before verification; the agency's officer and other Commissions cannot see it", async () => {
      ({ anne } = givenCommissions(api, NOW));
      givenLeaOfficers(api);
      const { id } = await submitLea(api);

      const early = await leaPreview(id);
      expect(early.statusCode).toBe(409);
      expect(early.json()).toMatchObject({ code: 'not-under-decision' });
      expect((await verifyLea(api, id, anne.id)).statusCode).toBe(200);

      expect((await leaPreview(id, supervisor)).statusCode).toBe(200);
      expect((await leaPreview(id, leaCallers.peter)).statusCode).toBe(403);
      expect((await leaPreview(id, tscOfficer)).statusCode).toBe(404);
      expect((await leaPreview(id, eacc)).statusCode).toBe(404);
    });
  });
});
