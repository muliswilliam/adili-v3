import { randomUUID } from 'node:crypto';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { certifiedCopies } from '../../src/db/schema.js';
import type { RosterCandidateFacts } from '../../src/directory/directory-client.js';
import { type AccessApi, startAccessApi } from '../support/access-api.js';
import { givenLeaOfficers, leaCallers, submitLea } from '../support/lea.js';
import { callers, givenCommissions, resolve, submitRequest } from '../support/requests.js';

const NOW = '2027-03-04T09:00:00.000Z';
const DECLARATION_ID = '0199c000-0000-7000-8000-000000000d01';

const { officer } = callers;
const { peter } = leaCallers;

interface AuditRead {
  tenant: string | null;
  data: {
    action: string;
    resource: {
      type: string;
      params: Record<string, string>;
      tenant: string | null;
      subjectPersonId: string | null;
      ids?: string[];
    };
    actor: { subject: string };
  };
}

/**
 * ADR-008: every read of sensitive data, and every search that returns declarant records, leaves
 * an `audit.read.v1` event naming the tenant and, when known, the person it is about.
 */
describe('Audited reads (ADR-008)', () => {
  let api: AccessApi;
  let anne: RosterCandidateFacts;

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  function given(): void {
    ({ anne } = givenCommissions(api, NOW));
    givenLeaOfficers(api);
  }

  /** The audit events recorded since the last call, oldest first. */
  let seen = 0;
  async function newAudits(): Promise<AuditRead[]> {
    const all = await api.events('audit.read.v1');
    const fresh = all.slice(seen) as unknown as AuditRead[];
    seen = all.length;
    return fresh;
  }

  async function expectOk(url: string, caller = officer): Promise<void> {
    const response = await api.get(url, caller);
    expect(response.statusCode, response.body).toBe(200);
  }

  it('the access officer reading a Form K request, and searching the roster for its officer, is audited', async () => {
    given();
    seen = 0;
    const { id } = await submitRequest(api);
    const resolved = await resolve(api, id, anne.id);
    expect(resolved.statusCode, resolved.body).toBe(200);
    await newAudits();

    await expectOk(`/v1/access/requests/${id}/officer`);
    await expectOk(`/v1/access/requests/${id}/roster-candidates?q=anne`);

    expect(await newAudits()).toEqual([
      expect.objectContaining({
        tenant: 'psc',
        data: expect.objectContaining({
          action: 'access.request.viewed',
          resource: {
            type: 'access-request',
            params: { requestId: id },
            tenant: 'psc',
            subjectPersonId: anne.personId,
          },
          actor: expect.objectContaining({ subject: officer.sub }) as unknown,
        }) as unknown,
      }),
      expect.objectContaining({
        tenant: 'psc',
        data: expect.objectContaining({
          action: 'access.roster-candidates.listed',
          resource: {
            type: 'roster-record',
            params: { requestId: id },
            tenant: 'psc',
            subjectPersonId: null,
            ids: [anne.id],
          },
        }) as unknown,
      }),
    ]);
  });

  it('reading a law enforcement request (the Commission or the filing officer) and its roster search are audited', async () => {
    given();
    seen = 0;
    const { id } = await submitLea(api);
    await newAudits();

    await expectOk(`/v1/lea/requests/${id}`);
    await expectOk(`/v1/lea/requests/${id}`, peter);
    await expectOk(`/v1/lea/requests/${id}/roster-candidates?q=PF-2011`);

    const audits = await newAudits();
    expect(
      audits.map((audit) => [audit.tenant, audit.data.action, audit.data.actor.subject]),
    ).toEqual([
      ['psc', 'lea.request.viewed', officer.sub],
      ['psc', 'lea.request.viewed', peter.sub],
      ['psc', 'lea.roster-candidates.listed', officer.sub],
    ]);
    expect(audits[0]?.data.resource).toEqual({
      type: 'lea-request',
      params: { leaRequestId: id },
      tenant: 'psc',
      // Not yet verified: the officer sought is not identified.
      subjectPersonId: null,
    });
    expect(audits[2]?.data.resource.ids).toEqual([anne.id]);
  });

  it('the self-access declarant search, version list and application read are audited', async () => {
    given();
    if (anne.personId === null) throw new Error('Anne is onboarded');
    api.declarations.givenFullDocument({
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
    });
    seen = 0;

    await expectOk('/v1/commissions/psc/access/self-access/declarants?q=anne');
    await expectOk(`/v1/commissions/psc/access/self-access/declarants/${anne.id}/versions`);
    const recorded = await api.send(
      'POST',
      '/v1/commissions/psc/access/self-access',
      officer,
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
    expect(recorded.statusCode, recorded.body).toBe(201);
    const applicationId = recorded.json<{ id: string }>().id;
    await expectOk(`/v1/access/self-access/${applicationId}`);

    const audits = await newAudits();
    // Let its certified copy settle, so no activity is still writing when the suite resets.
    await api.eventually(async () => {
      const [copy] = await api.asPlatform((tx) => tx.select().from(certifiedCopies));
      return copy?.status === 'issued' ? copy : undefined;
    });
    expect(audits.map((audit) => audit.data.action)).toEqual([
      'access.self-access.declarants.listed',
      'access.self-access.versions.listed',
      'access.self-access.viewed',
    ]);
    expect(audits.map((audit) => audit.data.resource)).toEqual([
      {
        type: 'roster-record',
        params: { slug: 'psc' },
        tenant: 'psc',
        subjectPersonId: null,
        ids: [anne.id],
      },
      {
        type: 'roster-record',
        params: { slug: 'psc', rosterRecordId: anne.id },
        tenant: 'psc',
        subjectPersonId: anne.personId,
      },
      {
        type: 'self-access-application',
        params: { applicationId },
        tenant: 'psc',
        subjectPersonId: anne.personId,
      },
    ]);
  });

  it('a refused read leaves no audit event', async () => {
    given();
    seen = 0;
    const { id } = await submitRequest(api);

    expect(
      (await api.get(`/v1/access/requests/${id}/officer`, callers.tscOfficer)).statusCode,
    ).toBe(404);
    expect((await api.get(`/v1/access/self-access/${randomUUID()}`, officer)).statusCode).toBe(404);

    expect(await newAudits()).toEqual([]);
  });
});
