import { randomUUID } from 'node:crypto';

import { EACC_ANALYST, PLATFORM_ADMIN } from '@adili/roles';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { certifiedCopies } from '../src/db/schema.js';
import type { VersionDocument } from '../src/declarations/declarations-client.js';
import { type AccessApi, type Caller, startAccessApi } from './support/access-api.js';
import { givenLeaOfficers, LEA_INPUT, leaCallers, submitLea } from './support/lea.js';
import {
  callers,
  COMPLETE,
  declarantOf,
  givenCommissions,
  notifiedRequest,
  submitRequest,
} from './support/requests.js';

const NOW = '2027-03-04T09:00:00.000Z';
const DECLARATION_ID = '0199c000-0000-7000-8000-000000000d01';

const ROLES = [
  'applicant',
  'declarant',
  'access-officer',
  'supervisor',
  'eacc',
  'law-enforcement',
  'platform-admin',
] as const;
type Role = (typeof ROLES)[number];

/** What a route answers each role: a status, the same for every role not listed (403 here). */
type Expected = Partial<Record<Role, number>>;

interface Route {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  body?: unknown;
  expected: Expected;
}

/** The statuses `Officer` routes answer: the access officer, supervisor reading, EACC 404. */
const officerRead = (status = 200): Expected => ({
  'access-officer': status,
  supervisor: status,
  eacc: 404,
});
/** The access officer acts (`status`), the supervisor reads only (403), EACC sees nothing (404). */
const officerAct = (status: number): Expected => ({
  'access-officer': status,
  supervisor: 403,
  eacc: 404,
});

/**
 * S16: every access route against every role of the spec's authorisation table. A role a route
 * is not for gets 403 (`@Roles`); EACC gets 404 on the Commission's officer routes (it sees no
 * access request, as for another Commission's); the roles a route is for get through (the
 * statuses for acts the setup makes invalid, such as a second resolution, prove the caller was
 * let past authorisation and visibility to the domain rules). The access officer goes last on
 * each route, so its acts do not change what the other roles see.
 */
describe('Access authorisation matrix (S16)', () => {
  let api: AccessApi;

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  it('S16: every route answers every role as the authorisation table says', async () => {
    const { anne } = givenCommissions(api, NOW);
    givenLeaOfficers(api);
    if (anne.personId === null) throw new Error('Anne is onboarded');
    const version: VersionDocument = {
      declarationId: DECLARATION_ID,
      versionId: randomUUID(),
      version: 1,
      personId: anne.personId,
      reference: 'DCI-PSC-2026-0000001-7',
      type: 'initial',
      statementDate: '2026-12-31',
      submittedAt: '2027-01-15T09:12:00.000Z',
      canonicalSha256: 'a'.repeat(64),
      commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
      declarantName: 'Anne Njeri Mutua',
      document: { schemaVersion: 'declaration.v1', type: 'initial' },
    };
    api.declarations.givenFullDocument(version);

    const anneDeclarant = declarantOf(anne);
    const as: Record<Role, Caller> = {
      applicant: callers.mercy,
      declarant: anneDeclarant,
      'access-officer': callers.officer,
      supervisor: callers.supervisor,
      eacc: { sub: 'analyst-eacc', roles: [EACC_ANALYST], tenant: 'eacc' },
      'law-enforcement': leaCallers.peter,
      'platform-admin': { sub: 'admin', roles: [PLATFORM_ADMIN], tenant: 'platform' },
    };

    // A Form K request notified to Anne, with her representations and an attachment; another,
    // only received, for the applicant to withdraw; two law enforcement requests (one for the
    // officer to withdraw); a self-access
    // application whose copy is issued; and Anne's own certified copy.
    const notified = await notifiedRequest(api, anne);
    const attachment = api.documents.givenUpload('psc', { uploadedBy: anneDeclarant.sub });
    const represented = await api.send(
      'PUT',
      `/v1/me/access-notices/${notified.id}/representations`,
      anneDeclarant,
      { stance: 'context', text: 'Some context.', attachments: [attachment.id] },
    );
    expect(represented.statusCode, represented.body).toBe(200);
    const toWithdraw = await submitRequest(api);
    const lea = await submitLea(api);
    const leaToWithdraw = await submitLea(api);
    const application = await api.send(
      'POST',
      '/v1/commissions/psc/access/self-access',
      callers.officer,
      {
        rosterRecordId: anne.id,
        declarationId: DECLARATION_ID,
        version: 1,
        identityNote: "Anne's national ID seen against her.",
        representative: null,
        deliveryMethod: 'collection',
      },
      { 'idempotency-key': randomUUID() },
    );
    expect(application.statusCode, application.body).toBe(201);
    const applicationId = application.json<{ id: string }>().id;
    const copy = await api.send('POST', '/v1/me/certified-copies', anneDeclarant, {
      commission: 'psc',
      declarationId: DECLARATION_ID,
      version: 1,
    });
    expect(copy.statusCode, copy.body).toBe(202);
    const copyId = copy.json<{ id: string }>().id;
    await api.eventually(async () => {
      const copies = await api.asPlatform((tx) => tx.select().from(certifiedCopies));
      return copies.every((found) => found.status === 'issued') ? copies : undefined;
    });

    const request = `/v1/access/requests/${notified.id}`;
    const leaRequest = `/v1/lea/requests/${lea.id}`;
    const routes: Route[] = [
      // Applicants: Form K.
      {
        method: 'GET',
        path: '/v1/access/commissions',
        expected: { applicant: 200, 'law-enforcement': 200 },
      },
      { method: 'POST', path: '/v1/access/requests', body: COMPLETE, expected: { applicant: 201 } },
      { method: 'GET', path: '/v1/access/requests', expected: { applicant: 200 } },
      { method: 'GET', path: request, expected: { applicant: 200 } },
      {
        method: 'POST',
        path: `/v1/access/requests/${toWithdraw.id}/withdraw`,
        body: {},
        expected: { applicant: 200 },
      },
      // Declarants: notices, history, certified copies.
      { method: 'GET', path: '/v1/me/access-notices', expected: { declarant: 200 } },
      {
        method: 'PUT',
        path: `/v1/me/access-notices/${notified.id}/representations`,
        body: { stance: 'context', text: 'More context.', attachments: [attachment.id] },
        expected: { declarant: 200 },
      },
      { method: 'GET', path: '/v1/me/access-history', expected: { declarant: 200 } },
      {
        method: 'POST',
        path: '/v1/me/certified-copies',
        body: { commission: 'psc', declarationId: DECLARATION_ID, version: 1 },
        expected: { declarant: 202 },
      },
      { method: 'GET', path: '/v1/me/certified-copies', expected: { declarant: 200 } },
      { method: 'GET', path: `/v1/me/certified-copies/${copyId}`, expected: { declarant: 200 } },
      // The Commission's officer routes: Form K.
      { method: 'GET', path: '/v1/commissions/psc/access/requests', expected: officerRead() },
      { method: 'GET', path: `${request}/officer`, expected: officerRead() },
      {
        method: 'GET',
        path: `${request}/representations/attachments/${attachment.id}/download`,
        expected: officerRead(),
      },
      { method: 'GET', path: `${request}/roster-candidates?q=anne`, expected: officerAct(200) },
      // Resolved already: 409 `officer-resolved` for the access officer.
      {
        method: 'POST',
        path: `${request}/resolve`,
        body: { rosterRecordId: anne.id },
        expected: officerAct(409),
      },
      // Not held for verification: 409 `not-pending-verification`.
      {
        method: 'POST',
        path: `${request}/verify-applicant`,
        body: { verified: true, note: 'Passport checked.' },
        expected: officerAct(409),
      },
      // Not yet under decision (Anne's window for representations is open): 409.
      {
        method: 'POST',
        path: `${request}/decision`,
        body: { outcome: 'deny', grounds: ['public-interest'], reasons: 'No.' },
        expected: officerAct(409),
      },
      // Law enforcement.
      {
        method: 'POST',
        path: '/v1/lea/requests',
        body: LEA_INPUT,
        expected: { 'law-enforcement': 201 },
      },
      { method: 'GET', path: '/v1/lea/requests', expected: { 'law-enforcement': 200 } },
      { method: 'GET', path: leaRequest, expected: { ...officerRead(), 'law-enforcement': 200 } },
      { method: 'GET', path: `${leaRequest}/roster-candidates?q=anne`, expected: officerAct(200) },
      {
        method: 'POST',
        path: `${leaRequest}/verify`,
        body: {
          provenanceConfirmed: true,
          reasonConfirmed: true,
          rosterRecordId: anne.id,
          note: 'Sent from the DCI account; reason and case reference stated.',
        },
        expected: officerAct(200),
      },
      {
        method: 'POST',
        path: `/v1/lea/requests/${leaToWithdraw.id}/withdraw`,
        body: {},
        expected: { 'law-enforcement': 200 },
      },
      // A denial without grounds: 400 `grounds-required`.
      {
        method: 'POST',
        path: `${leaRequest}/decision`,
        body: { outcome: 'deny', reasons: 'No.' },
        expected: officerAct(400),
      },
      // Written self-access applications.
      {
        method: 'GET',
        path: '/v1/commissions/psc/access/self-access/declarants?q=anne',
        expected: officerAct(200),
      },
      {
        method: 'GET',
        path: `/v1/commissions/psc/access/self-access/declarants/${anne.id}/versions`,
        expected: officerAct(200),
      },
      // No version 2 of Anne's: 400 at `version`.
      {
        method: 'POST',
        path: '/v1/commissions/psc/access/self-access',
        body: {
          rosterRecordId: anne.id,
          declarationId: DECLARATION_ID,
          version: 2,
          identityNote: "Anne's national ID seen against her.",
          representative: null,
          deliveryMethod: 'collection',
        },
        expected: officerAct(400),
      },
      { method: 'GET', path: '/v1/commissions/psc/access/self-access', expected: officerRead() },
      { method: 'GET', path: `/v1/access/self-access/${applicationId}`, expected: officerRead() },
      {
        method: 'POST',
        path: `/v1/access/self-access/${applicationId}/delivered`,
        body: {},
        expected: officerAct(200),
      },
    ];

    const order: Role[] = [...ROLES.filter((role) => role !== 'access-officer'), 'access-officer'];
    const actual: Record<string, Partial<Record<Role, number>>> = {};
    const wanted: Record<string, Partial<Record<Role, number>>> = {};
    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      actual[key] = {};
      wanted[key] = {};
      for (const role of order) {
        const response =
          route.method === 'GET'
            ? await api.get(route.path, as[role])
            : await api.send(route.method, route.path, as[role], route.body, {
                'idempotency-key': randomUUID(),
              });
        actual[key][role] = response.statusCode;
        wanted[key][role] = route.expected[role] ?? 403;
      }
    }
    expect(actual).toEqual(wanted);

    // Every copy settled before the suite resets.
    await api.eventually(async () => {
      const copies = await api.asPlatform((tx) =>
        tx.select().from(certifiedCopies).where(eq(certifiedCopies.status, 'pending')),
      );
      return copies.length === 0 ? copies : undefined;
    });
  });
});
