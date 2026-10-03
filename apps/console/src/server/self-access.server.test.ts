import { ACCESS_OFFICER, SUPERVISOR } from '@adili/roles';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockAccessClient } from './access/mock.server';
import {
  MOCK_SELF_ACCESS_IDS as A,
  mockSelfAccessDocumentsClient,
  resetSelfAccessMock,
  setSelfAccessMockLatency,
} from './access/self-access-mock.server';
import {
  completeProofUpload,
  copyDownload,
  declarantVersions,
  listApplications,
  loadApplication,
  markDelivered,
  recordApplication,
  reserveProofUpload,
  searchDeclarants,
  type SelfAccessApplicationInput,
  type SelfAccessResult,
} from './self-access.server';

const officer = () => mockAccessClient([ACCESS_OFFICER]);
const supervisor = () => mockAccessClient([SUPERVISOR]);
const documents = () => mockSelfAccessDocumentsClient([ACCESS_OFFICER]);
const key = () => crypto.randomUUID();

function dataOf<T>(result: SelfAccessResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

/** Alice Nekesa Wafula's roster record and her biennial declaration, version 2. */
const ALICE = 'a12d0000-0000-4000-8000-000000000001';
const ALICE_BIENNIAL = 'a12e0000-0000-4000-8000-000000000001';

async function cleanUpload(fileName: string): Promise<string> {
  const reserved = dataOf(
    await reserveProofUpload(
      documents(),
      { contentType: 'application/pdf', declaredSize: 2048, fileName },
      key(),
    ),
  );
  const completed = dataOf(await completeProofUpload(documents(), reserved.id, key()));
  expect(completed.state).toBe('clean');
  return completed.id;
}

function input(overrides: Partial<SelfAccessApplicationInput> = {}): SelfAccessApplicationInput {
  return {
    rosterRecordId: ALICE,
    declarationId: ALICE_BIENNIAL,
    version: 2,
    identityNote: 'National ID seen. It matches the roster record.',
    representative: null,
    deliveryMethod: 'collection',
    ...overrides,
  };
}

beforeAll(() => {
  setSelfAccessMockLatency(0);
});
afterAll(() => {
  setSelfAccessMockLatency(1);
});
beforeEach(() => {
  resetSelfAccessMock();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('finding the declarant and the version (slice #302)', () => {
  it('searches the roster by name or file number, onboarded or not', async () => {
    const found = dataOf(await searchDeclarants(officer(), 'psc', 'kariuki'));
    expect(found.items).toEqual([
      expect.objectContaining({ fullName: 'Daniel Mwangi Kariuki', onboarded: false }),
    ]);
    const byFile = dataOf(await searchDeclarants(officer(), 'psc', '20118876'));
    expect(byFile.items.map((item) => item.fullName)).toEqual(['Alice Nekesa Wafula']);
  });

  it('lists the versions latest first, the superseded one marked', async () => {
    const versions = dataOf(await declarantVersions(officer(), 'psc', ALICE));
    expect(versions.versions.map((each) => [each.version, each.superseded])).toEqual([
      [2, false],
      [1, true],
      [1, false],
    ]);
  });

  it('answers the supervisor 403 and an unreachable roster 503', async () => {
    const forbidden = await searchDeclarants(supervisor(), 'psc', 'wafula');
    expect(
      !forbidden.ok && forbidden.error.kind === 'problem' && forbidden.error.problem.status,
    ).toBe(403);
    const offline = await searchDeclarants(officer(), 'psc', 'offline');
    expect(!offline.ok && offline.error.kind).toBe('unavailable');
  });
});

describe('recording an application and its certified copy (slice #302)', () => {
  it("records a representative's application with both proofs; the copy is issued for the officer to print", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const authority = await cleanUpload('authority.pdf');
    const identification = await cleanUpload('id.pdf');

    const recorded = dataOf(
      await recordApplication(
        officer(),
        'psc',
        input({
          representative: {
            name: 'Joseph Kiprono',
            idNumber: '23456789',
            authorityUploadId: authority,
            idUploadId: identification,
          },
        }),
        key(),
      ),
    );
    expect(recorded).toMatchObject({
      status: 'recorded',
      recordedByCaller: true,
      representative: { name: 'Joseph Kiprono', idNumber: '23456789' },
      certifiedCopy: { status: 'pending', documentId: null },
    });

    vi.setSystemTime(Date.now() + 3500);
    const issued = dataOf(await loadApplication(officer(), recorded.id));
    expect(issued).toMatchObject({ status: 'issued', certifiedCopy: { status: 'issued' } });
    const documentId = issued.certifiedCopy.documentId ?? '';
    expect(dataOf(await copyDownload(documents(), documentId)).downloadUrl).toContain(documentId);

    // Another officer of the Commission is not named on the copy.
    const colleague = await copyDownload(
      mockSelfAccessDocumentsClient([ACCESS_OFFICER], 'another-officer'),
      documentId,
    );
    expect(
      !colleague.ok && colleague.error.kind === 'problem' && colleague.error.problem.status,
    ).toBe(404);
  });

  it("refuses a proof that is not the officer's clean upload, naming it", async () => {
    const authority = await cleanUpload('authority.pdf');
    const result = await recordApplication(
      officer(),
      'psc',
      input({
        representative: {
          name: 'Joseph Kiprono',
          idNumber: '23456789',
          authorityUploadId: authority,
          idUploadId: crypto.randomUUID(),
        },
      }),
      key(),
    );
    expect(!result.ok && result.error.kind === 'problem' && result.error.problem.errors).toEqual([
      expect.objectContaining({ path: 'representative.idUploadId' }),
    ]);
  });

  it('scans a proof named like a virus as infected', async () => {
    const reserved = dataOf(
      await reserveProofUpload(
        documents(),
        { contentType: 'image/jpeg', declaredSize: 900, fileName: 'virus.jpg' },
        key(),
      ),
    );
    expect(dataOf(await completeProofUpload(documents(), reserved.id, key())).state).toBe(
      'infected',
    );
  });
});

describe('the list and handing over (slice #302)', () => {
  it('lists those still to hand over by earliest deadline, then the delivered ones by latest', async () => {
    const page = dataOf(await listApplications(officer(), 'psc', undefined));
    expect(page.items.map((item) => item.id)).toEqual([
      A.failed,
      A.ready,
      A.colleague,
      A.preparing,
      A.dispatched,
      A.collected,
    ]);
    expect(page.items[0]).toMatchObject({ late: true });
    expect(page.items[1]?.representative).not.toHaveProperty('idNumber');
  });

  it('marks a ready copy collected once; a copy still being prepared is 409', async () => {
    const marked = dataOf(await markDelivered(officer(), A.ready, key()));
    expect(marked).toMatchObject({
      status: 'delivered',
      deliveredAt: expect.any(String) as string,
    });
    const again = await markDelivered(officer(), A.ready, key());
    expect(!again.ok && again.error.kind === 'problem' && again.error.problem.status).toBe(409);
    const preparing = await markDelivered(officer(), A.preparing, key());
    expect(
      !preparing.ok && preparing.error.kind === 'problem' && preparing.error.problem.status,
    ).toBe(409);
    const asSupervisor = await markDelivered(supervisor(), A.colleague, key());
    expect(
      !asSupervisor.ok &&
        asSupervisor.error.kind === 'problem' &&
        asSupervisor.error.problem.status,
    ).toBe(403);
  });

  it('tells the supervisor and other officers they did not record it', async () => {
    expect(dataOf(await loadApplication(officer(), A.colleague)).recordedByCaller).toBe(false);
    expect(dataOf(await loadApplication(supervisor(), A.ready)).recordedByCaller).toBe(false);
    expect(dataOf(await loadApplication(officer(), A.ready)).recordedByCaller).toBe(true);
  });
});
