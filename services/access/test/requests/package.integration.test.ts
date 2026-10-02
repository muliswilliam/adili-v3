import { createEnvelope, type EventEnvelope } from '@adili/events';
import { DOCUMENT_DOWNLOADED, type DocumentDownloadedData } from '@adili/events/contracts';
import { ApplicationFailure } from '@temporalio/common';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { INVARIANT_BROKEN } from '../../src/activity-retry.js';
import { accessRequests } from '../../src/db/schema.js';
import type { DisclosureDocument } from '../../src/declarations/declarations-client.js';
import {
  accessRequestWorkflowId,
  type AccessRequestWorkflowInput,
} from '../../src/requests/contract.js';
import { DecisionActivities } from '../../src/requests/decision-activities.js';
import { DownloadsConsumer } from '../../src/requests/downloads.consumer.js';
import type { AccessRequest } from '../../src/requests/representation.js';
import type { AccessRequestRow } from '../../src/requests/representation.js';
import { type AccessApi, startAccessApi } from '../support/access-api.js';
import {
  callers,
  ENDED_TRANSACTION,
  decide,
  givenCommissions,
  rowOf,
  underDecisionRequest,
} from '../support/requests.js';

const NOW = '2027-03-04T09:00:00.000Z';
const DECIDED_AT = '2027-03-20T12:00:00.000Z';
const EXPIRES_AT = '2027-04-03T12:00:00.000Z';
const VERIFICATION_ID = 'ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-9KMV-8P';

/**
 * A grant's package after issue (S7): each download documents reports is registered, the window's
 * end is registered as `expired`, and issuing is safe to retry. Downloads themselves (the link,
 * 404 to anyone but the applicant, 410 after the window) are documents' (#258).
 */
describe("A grant's package: downloads and expiry (S7)", () => {
  let api: AccessApi;
  let consumer: DownloadsConsumer;
  let activities: DecisionActivities;
  const { mercy } = callers;

  beforeAll(async () => {
    api = await startAccessApi();
    consumer = api.app.get(DownloadsConsumer);
    activities = api.app.get(DecisionActivities);
    return () => api.close();
  });

  afterEach(() => api.reset());

  function disclosureOf(reference: string): DisclosureDocument {
    return {
      schemaVersion: 'disclosure.v1',
      grantReference: reference,
      personName: 'Anne Njeri Mutua',
      commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
      versions: [],
    };
  }

  /** Mercy's request, granted on 20 March; `disclose: false` leaves Anne nothing in scope. */
  async function granted({ disclose = true } = {}): Promise<{
    input: AccessRequestWorkflowInput;
    row: AccessRequestRow;
  }> {
    const { anne } = givenCommissions(api, NOW);
    const row = await underDecisionRequest(api, anne);
    if (disclose) {
      api.declarations.givenDisclosure(anne.personId ?? '', disclosureOf(row.reference));
    }
    api.clock.set(DECIDED_AT);
    const response = await decide(api, row.id, { outcome: 'grant', reasons: 'Shown.' });
    expect(response.statusCode, response.body).toBe(200);
    return {
      input: {
        tenant: 'psc',
        requestId: row.id,
        submittedAt: NOW,
        transactionId: ENDED_TRANSACTION,
      },
      row: await rowOf(api, row.id),
    };
  }

  /** A granted request with its package issued; its workflow stopped, so the test runs the rest. */
  async function packaged(): Promise<{ input: AccessRequestWorkflowInput; row: AccessRequestRow }> {
    const { input } = await granted();
    const row = await api.eventually(async () => {
      const found = await rowOf(api, input.requestId);
      return found.packageDocumentId === null ? undefined : found;
    });
    await api.endWorkflows([accessRequestWorkflowId(input.requestId)]);
    return { input, row };
  }

  function downloaded(
    row: AccessRequestRow,
    data: Partial<DocumentDownloadedData> = {},
  ): EventEnvelope {
    return createEnvelope('adili/documents', {
      type: DOCUMENT_DOWNLOADED,
      subject: row.packageDocumentId ?? '',
      tenant: 'psc',
      data: {
        documentId: row.packageDocumentId ?? '',
        verificationId: VERIFICATION_ID,
        documentType: 'access-package',
        issuerTenant: 'psc',
        subjectRef: `access-request:${row.id}`,
        downloadedBy: mercy.sub,
        downloadedAt: '2027-03-21T08:00:00.000Z',
        downloadExpiresAt: EXPIRES_AT,
        ...data,
      } satisfies DocumentDownloadedData,
    });
  }

  const mine = async (id: string) => {
    const response = await api.get(`/v1/access/requests/${id}`, mercy);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<AccessRequest>();
  };

  describe('downloads', () => {
    it('S7: each download of the package is registered once, with the applicant as actor', async () => {
      const { row } = await packaged();
      const first = downloaded(row);

      expect(await consumer.downloaded(first)).toBe(true);
      expect(await consumer.downloaded(first)).toBe(false);
      expect(
        await consumer.downloaded(downloaded(row, { downloadedAt: '2027-03-22T08:00:00.000Z' })),
      ).toBe(true);

      const request = await mine(row.id);
      expect(request.package?.downloads).toBe(2);
      expect(request.timeline.filter((entry) => entry.kind === 'downloaded')).toEqual([
        expect.objectContaining({ at: '2027-03-21T08:00:00.000Z', actor: 'Mercy Wanjiku Kamau' }),
        expect.objectContaining({ at: '2027-03-22T08:00:00.000Z', actor: 'Mercy Wanjiku Kamau' }),
      ]);
      const events = await api.events('access.request.downloaded.v1');
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        tenant: 'psc',
        subject: row.id,
        data: {
          kind: 'downloaded',
          legalBasis: 'act-s36-1',
          actor: mercy.sub,
          personId: row.resolvedPersonId,
          documentId: row.packageDocumentId,
          at: '2027-03-21T08:00:00.000Z',
        },
      });
    });

    it('downloads of other documents are not the register of Form K requests', async () => {
      const { row } = await packaged();

      // A law enforcement package's subject: consumed, but no law enforcement request holds it.
      expect(
        await consumer.downloaded(downloaded(row, { subjectRef: `lea-request:${row.id}` })),
      ).toBe(true);
      expect(await consumer.downloaded(downloaded(row, { documentType: 'certified-copy' }))).toBe(
        false,
      );
      expect(
        await consumer.downloaded(downloaded(row, { subjectRef: `certified-copy:${row.id}` })),
      ).toBe(false);
      // The request's id with another document: not its package.
      expect(
        await consumer.downloaded(
          downloaded(row, { documentId: '0199c000-0000-7000-8000-0000000000aa' }),
        ),
      ).toBe(true);

      expect((await mine(row.id)).package?.downloads).toBe(0);
      expect(await api.events('access.request.downloaded.v1')).toEqual([]);
    });
  });

  describe('expiry', () => {
    it('S7: at the end of the window the register records the package expired, once', async () => {
      const { input, row } = await packaged();

      expect(await activities.expirePackage(input)).toBe('expired');
      expect(await activities.expirePackage(input)).toBe('expired');

      const expired = (await mine(row.id)).timeline.filter((entry) => entry.kind === 'expired');
      expect(expired).toEqual([expect.objectContaining({ at: EXPIRES_AT, actor: null })]);
      const events = await api.events('access.request.expired.v1');
      expect(events).toHaveLength(1);
      expect(events[0]?.data).toMatchObject({
        kind: 'expired',
        actor: null,
        documentId: row.packageDocumentId,
      });
    });
  });

  describe('issue', () => {
    it("the package is downloadable for the Commission's download window in force at issue", async () => {
      api.directory.givenAccessPolicy('psc', { packageDownloadDays: 7 });
      const { row } = await packaged();

      expect(api.documents.issued).toMatchObject([{ downloadWindowDays: 7 }]);
      expect(row.downloadExpiresAt).toEqual(new Date('2027-03-27T12:00:00.000Z'));
    });

    it('a retried issue issues nothing twice', async () => {
      const { input, row } = await packaged();

      const again = await activities.issuePackage(input);

      expect(again).toEqual({ outcome: 'issued', downloadExpiresAt: EXPIRES_AT });
      expect(api.documents.issued).toHaveLength(1);
      expect(await api.events('access.request.package-issued.v1')).toHaveLength(1);
      expect((await rowOf(api, input.requestId)).packageDocumentId).toBe(row.packageDocumentId);
    });

    it('declarations unreachable: the workflow retries until the package is issued', async () => {
      api.declarations.failCalls(2);

      const { input } = await granted();

      const row = await api.eventually(async () => {
        const found = await rowOf(api, input.requestId);
        return found.packageDocumentId === null ? undefined : found;
      });
      expect(api.declarations.disclosureCalls).toHaveLength(3);
      expect(api.documents.issued).toHaveLength(1);
      expect(row.downloadExpiresAt).toEqual(new Date(EXPIRES_AT));
    });

    it('documents refusing the package fails the run without retrying it (no package, nothing told)', async () => {
      api.documents.refuseCalls(1);

      const { input } = await granted();

      const handle = api.temporal.workflow.getHandle(accessRequestWorkflowId(input.requestId));
      await api.eventually(async () => (await handle.describe()).status.name === 'FAILED');
      expect(api.declarations.disclosureCalls).toHaveLength(1);
      expect(api.documents.issued).toEqual([]);
      expect((await rowOf(api, input.requestId)).packageDocumentId).toBeNull();
      expect(api.notifications.sent.map((m) => m.template)).not.toContain(
        'access-package-ready-email',
      );
    });

    it('a request with no grant is a broken invariant: not retried', async () => {
      const { input } = await granted();
      await api.endWorkflows([accessRequestWorkflowId(input.requestId)]);
      await api.asPlatform((tx) =>
        tx
          .update(accessRequests)
          .set({ status: 'denied', packageDocumentId: null, downloadExpiresAt: null })
          .where(eq(accessRequests.id, input.requestId)),
      );

      const failure = await activities.issuePackage(input).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ApplicationFailure);
      expect(failure).toMatchObject({ type: INVARIANT_BROKEN, nonRetryable: true });
    });

    it('nothing of the declarant in the granted scope: no package, no package notice', async () => {
      const { input } = await granted({ disclose: false });

      await api.eventually(async () => {
        const handle = api.temporal.workflow.getHandle(accessRequestWorkflowId(input.requestId));
        return (await handle.describe()).status.name === 'COMPLETED';
      });
      expect(api.declarations.disclosureCalls).toHaveLength(1);
      expect(api.documents.issued).toEqual([]);
      expect((await rowOf(api, input.requestId)).packageDocumentId).toBeNull();
      expect(api.notifications.sent.map((m) => m.template)).not.toContain(
        'access-package-ready-email',
      );
    });
  });
});
