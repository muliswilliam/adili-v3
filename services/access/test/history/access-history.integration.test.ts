import { randomUUID } from 'node:crypto';

import { DECLARANT } from '@adili/roles';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { leaRequests } from '../../src/db/schema.js';
import type { AccessHistoryEntry } from '../../src/history/representation.js';
import { AccessRegister, type RegisterEntryInput } from '../../src/register/access-register.js';
import { accessRequestWorkflowId } from '../../src/requests/contract.js';
import type { CertifiedCopy } from '../../src/self-access/representation.js';
import { type AccessApi, type Caller, startAccessApi } from '../support/access-api.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  callers,
  decide,
  declarantOf,
  givenCommissions,
  notifiedRequest,
  resolve,
  rowOf,
  submitRequest,
  underDecisionRequest,
} from '../support/requests.js';

const NOW = '2027-03-04T09:00:00.000Z';
const DECIDED_AT = '2027-03-20T12:00:00.000Z';

/**
 * Who accessed my declaration (S12): the declarant sees a Form K request about them from the
 * moment they were notified (who asked, the decision, the package and its downloads), a law
 * enforcement request only once it is granted (the agency and case, the package and its
 * downloads), and their certified copies; never staff or law enforcement officers by name.
 * Another declarant sees nothing of it.
 */
/** The law enforcement package of the history suite. */
const PACKAGE_ID = '0199c000-0000-7000-8000-00000000a001';

/** An entry of any step, the tenant left out. */
type WithoutTenant<T> = T extends unknown ? Omit<T, 'tenant'> : never;

describe('Who accessed my declaration (S12)', () => {
  let api: AccessApi;
  let register: AccessRegister;

  beforeAll(async () => {
    api = await startAccessApi();
    register = api.app.get(AccessRegister);
    return () => api.close();
  });

  afterEach(() => api.reset());

  const otieno = {
    sub: 'declarant-otieno',
    roles: [DECLARANT],
    tenant: 'psc',
    personId: randomUUID(),
  } satisfies Caller;

  async function historyOf(caller: Caller): Promise<AccessHistoryEntry[]> {
    const response = await api.get('/v1/me/access-history', caller);
    expect(response.statusCode, response.body).toBe(200);
    const entries = response.json<AccessHistoryEntry[]>();
    expect(contractErrors(okResponse('/v1/me/access-history', 'get', 200), entries)).toEqual([]);
    return entries;
  }

  const kinds = (entries: AccessHistoryEntry[]) => entries.map((entry) => entry.kind);

  /** Records a register entry in the Commission's context, as the service's steps do. */
  const record = (entry: WithoutTenant<RegisterEntryInput>) =>
    api.asTenant({ tenant: 'psc', subject: 'test' }, (tx) =>
      register.record(tx, { tenant: 'psc', ...entry }),
    );

  describe('Form K requests', () => {
    it('S12: nothing shows before the declarant is notified, then the request from notification on', async () => {
      const { anne } = givenCommissions(api, NOW);
      const anneCaller = declarantOf(anne);
      const { id } = await submitRequest(api);

      expect(await historyOf(anneCaller)).toEqual([]);

      const resolved = await resolve(api, id, anne.id);
      expect(resolved.statusCode, resolved.body).toBe(200);
      const row = await api.eventually(async () => {
        const found = await rowOf(api, id);
        return found.notifiedAt === null ? undefined : found;
      });

      const entries = await historyOf(anneCaller);
      expect(entries).toEqual([
        {
          id: expect.any(String) as unknown,
          kind: 'notified',
          at: row.notifiedAt?.toISOString(),
          actor: null,
          summary: 'Declarant notified',
          subjectKind: 'access-request',
          subjectId: id,
          reference: row.reference,
          commission: { slug: 'psc', name: 'Public Service Commission' },
          requester: 'Mercy Wanjiku Kamau',
          caseReference: null,
          outcome: null,
          certifiedCopy: null,
        },
      ]);
      // The applicant's receipt (and anything else before the notice) never shows.
      expect(kinds(entries)).not.toContain('received');
    });

    it('S12: the representations, decision, package and downloads follow, newest first, with no staff names', async () => {
      const { anne } = givenCommissions(api, NOW);
      const row = await underDecisionRequest(api, anne);
      api.declarations.givenDisclosure(anne.personId ?? '', {
        schemaVersion: 'disclosure.v1',
        grantReference: row.reference,
        personName: 'Anne Njeri Mutua',
        commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
        versions: [],
      });
      api.clock.set(DECIDED_AT);
      const decided = await decide(api, row.id, { outcome: 'grant', reasons: 'Shown.' });
      expect(decided.statusCode, decided.body).toBe(200);
      const packaged = await api.eventually(async () => {
        const found = await rowOf(api, row.id);
        return found.packageDocumentId === null ? undefined : found;
      });
      await api.endWorkflows([accessRequestWorkflowId(row.id)]);
      await record({
        subjectKind: 'access-request',
        subjectId: row.id,
        reference: row.reference,
        personId: anne.personId,
        kind: 'downloaded',
        actor: { subject: callers.mercy.sub, name: row.applicantName },
        at: new Date('2027-03-21T08:00:00.000Z'),
        details: { documentId: packaged.packageDocumentId },
        eventData: { documentId: packaged.packageDocumentId ?? '' },
      });

      const entries = await historyOf(declarantOf(anne));

      expect(kinds(entries)).toEqual([
        'downloaded',
        'package-issued',
        'decided',
        'representations',
        'notified',
      ]);
      const byKind = new Map(entries.map((entry) => [entry.kind, entry]));
      expect(byKind.get('decided')).toMatchObject({ outcome: 'grant', actor: null });
      // The applicant is named on their own steps; the access officer never is.
      expect(byKind.get('downloaded')).toMatchObject({ actor: 'Mercy Wanjiku Kamau' });
      expect(JSON.stringify(entries)).not.toContain(callers.officer.name);
      expect(entries.every((entry) => entry.requester === 'Mercy Wanjiku Kamau')).toBe(true);
    });

    it('S12: another declarant sees nothing of a request about Anne', async () => {
      const { anne } = givenCommissions(api, NOW);
      await notifiedRequest(api, anne);

      expect(await historyOf(otieno)).toEqual([]);
      expect(await historyOf(declarantOf(anne))).toHaveLength(1);
    });
  });

  describe('law enforcement requests (seeded rows)', () => {
    /** A DCI request about `personId`, verified by the PSC's access officer, not yet decided. */
    async function verifiedLeaRequest(
      personId: string,
    ): Promise<{ id: string; reference: string }> {
      const id = randomUUID();
      const reference = 'LEA-PSC-2027-0000004-3';
      await api.asTenant({ tenant: 'psc', subject: 'test' }, (tx) =>
        tx.insert(leaRequests).values({
          id,
          tenant: 'psc',
          commissionName: 'Public Service Commission',
          reference,
          officerSubject: 'lea-officer-peter',
          officerPersonId: randomUUID(),
          officerName: 'Peter Mwangi',
          agencyCode: 'DCI',
          agencyName: 'Directorate of Criminal Investigations',
          provenance: {
            accountState: 'activated',
            activatedAt: null,
            agencyLegalBasis: 'National Police Service Act, 2011, s.35',
            checkedAt: '2027-03-02T08:00:00.000Z',
          },
          officerSought: { name: 'Anne Njeri Mutua' },
          reason: 'Investigation into procurement',
          caseReference: 'DCI/INV/118/2027',
          scope: {
            years: [2026],
            includeSpouses: false,
            includeChildren: false,
            sections: ['assets'],
            includeClarifications: false,
          },
          status: 'verified',
          resolvedRosterRecordId: randomUUID(),
          resolvedPersonId: personId,
          resolvedName: 'Anne Njeri Mutua',
          receivedAt: new Date('2027-03-01T08:00:00.000Z'),
          deadlineAt: new Date('2027-03-15T08:00:00.000Z'),
        }),
      );
      const common = { subjectKind: 'lea-request' as const, subjectId: id, reference, personId };
      await record({
        ...common,
        personId: null,
        kind: 'received',
        actor: { subject: 'lea-officer-peter', name: 'Peter Mwangi' },
        at: new Date('2027-03-01T08:00:00.000Z'),
        eventData: { decisionDeadlineAt: '2027-03-15T08:00:00.000Z' },
      });
      await record({
        ...common,
        kind: 'verified',
        actor: { subject: callers.officer.sub, name: callers.officer.name },
        at: new Date('2027-03-02T08:00:00.000Z'),
      });
      return { id, reference };
    }

    it('S12: a law enforcement request shows only once granted: the agency and case, the decision, package and downloads', async () => {
      const { anne } = givenCommissions(api, NOW);
      const personId = anne.personId ?? '';
      const { id, reference } = await verifiedLeaRequest(personId);

      expect(await historyOf(declarantOf(anne))).toEqual([]);

      const decidedAt = new Date('2027-03-05T10:00:00.000Z');
      await api.asTenant({ tenant: 'psc', subject: 'test' }, (tx) =>
        tx
          .update(leaRequests)
          .set({
            status: 'granted',
            decision: {
              outcome: 'grant',
              grantedScope: null,
              grounds: [],
              reasons: 'Investigation shown.',
              decidedBy: { subject: callers.officer.sub, name: callers.officer.name },
              decidedAt: decidedAt.toISOString(),
            },
          })
          .where(eq(leaRequests.id, id)),
      );
      const common = { subjectKind: 'lea-request' as const, subjectId: id, reference, personId };
      await record({
        ...common,
        kind: 'decided',
        actor: { subject: callers.officer.sub, name: callers.officer.name },
        at: decidedAt,
        details: { outcome: 'grant' },
        eventData: { outcome: 'grant', grounds: [] },
      });
      await record({
        ...common,
        kind: 'package-issued',
        actor: null,
        at: new Date('2027-03-05T10:04:00.000Z'),
        eventData: { documentId: PACKAGE_ID, downloadExpiresAt: '2027-03-19T10:04:00.000Z' },
      });
      await record({
        ...common,
        kind: 'downloaded',
        actor: { subject: 'lea-officer-peter', name: 'Peter Mwangi' },
        at: new Date('2027-03-06T09:00:00.000Z'),
        eventData: { documentId: PACKAGE_ID },
      });

      const entries = await historyOf(declarantOf(anne));

      expect(kinds(entries)).toEqual(['downloaded', 'package-issued', 'decided']);
      for (const entry of entries) {
        expect(entry).toMatchObject({
          subjectKind: 'lea-request',
          subjectId: id,
          reference,
          commission: { slug: 'psc', name: 'Public Service Commission' },
          requester: 'Directorate of Criminal Investigations',
          caseReference: 'DCI/INV/118/2027',
          actor: null,
        });
      }
      expect(entries.at(-1)).toMatchObject({ outcome: 'grant' });
      // Neither the law enforcement officer nor the access officer is named.
      expect(JSON.stringify(entries)).not.toContain('Peter Mwangi');
      expect(JSON.stringify(entries)).not.toContain(callers.officer.name);
      // Agency, case, outcome and dates only: never the agency's reason or the decision's.
      expect(JSON.stringify(entries)).not.toContain('Investigation into procurement');
      expect(JSON.stringify(entries)).not.toContain('Investigation shown.');
      expect(await historyOf(otieno)).toEqual([]);
    });
  });

  describe('certified copies', () => {
    it('S12: the declarant sees their certified copies as self-access', async () => {
      const { anne } = givenCommissions(api, NOW);
      const anneCaller = { ...declarantOf(anne), name: 'Anne Njeri Mutua' };
      const declarationId = randomUUID();
      api.declarations.givenFullDocument({
        declarationId,
        versionId: randomUUID(),
        version: 2,
        personId: anne.personId ?? '',
        reference: 'DCB-PSC-2027-0000009-4',
        type: 'biennial',
        statementDate: '2026-12-31',
        submittedAt: '2027-01-20T10:00:00.000Z',
        canonicalSha256: 'b'.repeat(64),
        commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
        declarantName: 'Anne Njeri Mutua',
        document: { schemaVersion: 'declaration.v1' },
      });
      const asked = await api.send('POST', '/v1/me/certified-copies', anneCaller, {
        commission: 'psc',
        declarationId,
        version: 2,
      });
      expect(asked.statusCode, asked.body).toBe(202);
      const { id } = asked.json<CertifiedCopy>();
      const issued = await api.eventually(async () => {
        const copy = (
          await api.get(`/v1/me/certified-copies/${id}`, anneCaller)
        ).json<CertifiedCopy>();
        return copy.status === 'issued' ? copy : undefined;
      });

      expect(await historyOf(anneCaller)).toEqual([
        {
          id: expect.any(String) as unknown,
          kind: 'self-access',
          at: NOW,
          actor: null,
          summary: 'Certified copy issued',
          subjectKind: 'self-access',
          subjectId: id,
          reference: 'DCB-PSC-2027-0000009-4',
          commission: { slug: 'psc', name: 'Public Service Commission' },
          requester: null,
          caseReference: null,
          outcome: null,
          certifiedCopy: {
            id,
            declarationId,
            version: 2,
            documentId: issued.documentId,
            representativeName: null,
          },
        },
      ]);
      expect(await historyOf(otieno)).toEqual([]);
    });
  });
});
