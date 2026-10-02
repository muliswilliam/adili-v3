import createClient from 'openapi-fetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bearer,
  completeDraft,
  declarationsClient,
  idempotencyKey,
  PERSON,
} from '../test/declarant';
import { loadHistory } from './access-history.server';
import { mockAccessFetch, resetAccessMock, setAccessMockLatency } from './access/mock.server';
import { MOCK_COPY_IDS, resetHistoryMock } from './access/mock-history.server';
import { resetNoticesMock } from './access/mock-notices.server';
import type { paths } from './access/schema.gen';
import { listCopies, readCopy, readCopyDownload, requestCopy } from './certified-copies.server';
import { resetDeclarationsMock } from './declarations/mock.server';
import type { paths as documentsPaths } from './documents/schema.gen';
import { loadSubmittedVersions } from './my-declarations.server';
import { amendDeclaration } from './my-declarations.server';
import { submitDeclaration } from './submission.server';

const NOW = Date.parse('2026-10-02T07:00:00Z');

/** The declarant as the access mock reads them: their person and the realm role. */
const DECLARANT = bearer({ ...PERSON, realm_access: { roles: ['declarant'] } });

function access(authorization = DECLARANT, fetch: typeof mockAccessFetch = mockAccessFetch) {
  return createClient<paths>({ baseUrl: 'http://access.test', fetch, headers: { authorization } });
}

function documents(authorization = DECLARANT) {
  return createClient<documentsPaths>({
    baseUrl: 'http://documents.test',
    fetch: mockAccessFetch,
    headers: { authorization },
  });
}

const down = () => Promise.reject(new TypeError('fetch failed'));

/** A declaration of the declarant submitted twice: version 1 superseded, version 2 in force. */
async function filedTwice() {
  const id = await completeDraft();
  const client = declarationsClient();
  await submitDeclaration(client, { declarationId: id, idempotencyKey: idempotencyKey() });
  await amendDeclaration(client, id);
  await submitDeclaration(client, { declarationId: id, idempotencyKey: idempotencyKey() });
  return id;
}

/** Lets the mock's issuing time pass. */
function later(ms = 3500) {
  vi.setSystemTime(Date.now() + ms);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setAccessMockLatency(0);
  resetDeclarationsMock();
  resetAccessMock(NOW);
  resetNoticesMock(NOW);
  resetHistoryMock(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('certified copies (S13)', () => {
  it('asks for a copy, which is pending, then issued with the version reference', async () => {
    const id = await filedTwice();
    const asked = await requestCopy(
      access(),
      { commission: 'psc', declarationId: id, version: 2 },
      crypto.randomUUID(),
    );
    if (asked.status !== 'ok') throw new Error(asked.status);
    expect(asked.copy).toMatchObject({ status: 'pending', documentId: null, reference: null });

    expect(await readCopy(access(), asked.copy.id)).toMatchObject({
      status: 'ok',
      copy: { status: 'pending' },
    });
    later();
    const issued = await readCopy(access(), asked.copy.id);
    if (issued.status !== 'ok') throw new Error(issued.status);
    expect(issued.copy.status).toBe('issued');
    expect(issued.copy.reference).toMatch(/^DCI-PSC-/);
    expect(issued.copy.commission).toEqual({ slug: 'psc', name: 'Public Service Commission' });
  });

  it('answers with the same copy when asked again for the version', async () => {
    const id = await filedTwice();
    const body = { commission: 'psc', declarationId: id, version: 2 };
    const first = await requestCopy(access(), body, crypto.randomUUID());
    const again = await requestCopy(access(), body, crypto.randomUUID());
    if (first.status !== 'ok' || again.status !== 'ok') throw new Error('not ok');
    expect(again.copy.id).toBe(first.copy.id);
  });

  it('fails a copy of a version that is not the declarant’s, and lets them try again', async () => {
    const asked = await requestCopy(
      access(),
      { commission: 'psc', declarationId: crypto.randomUUID(), version: 1 },
      crypto.randomUUID(),
    );
    if (asked.status !== 'ok') throw new Error(asked.status);
    later();
    expect(await readCopy(access(), asked.copy.id)).toMatchObject({ copy: { status: 'failed' } });
  });

  it('fails the first copy of a superseded version once, as when documents is down', async () => {
    const id = await filedTwice();
    const body = { commission: 'psc', declarationId: id, version: 1 };
    const first = await requestCopy(access(), body, crypto.randomUUID());
    if (first.status !== 'ok') throw new Error(first.status);
    later();
    expect(await readCopy(access(), first.copy.id)).toMatchObject({ copy: { status: 'failed' } });

    const retried = await requestCopy(access(), body, crypto.randomUUID());
    expect(retried).toMatchObject({ copy: { id: first.copy.id, status: 'pending' } });
    later();
    expect(await readCopy(access(), first.copy.id)).toMatchObject({ copy: { status: 'issued' } });
  });

  it('replays the first answer for the same Idempotency-Key', async () => {
    const id = await filedTwice();
    const key = crypto.randomUUID();
    const first = await requestCopy(
      access(),
      { commission: 'psc', declarationId: id, version: 2 },
      key,
    );
    const replay = await requestCopy(
      access(),
      { commission: 'psc', declarationId: id, version: 2 },
      key,
    );
    expect(replay).toEqual(first);
  });

  it('is not found for an unknown Commission, and unavailable when the service is down', async () => {
    const body = { commission: 'nowhere', declarationId: crypto.randomUUID(), version: 1 };
    expect(await requestCopy(access(), body, crypto.randomUUID())).toEqual({ status: 'not-found' });
    expect(await requestCopy(access(DECLARANT, down), body, crypto.randomUUID())).toEqual({
      status: 'unavailable',
    });
    expect(await readCopy(access(), crypto.randomUUID())).toEqual({ status: 'not-found' });
  });

  it('lists the copies, latest asked for first', async () => {
    const id = await filedTwice();
    later(60_000);
    await requestCopy(
      access(),
      { commission: 'psc', declarationId: id, version: 2 },
      crypto.randomUUID(),
    );
    const listed = await listCopies(access());
    if (listed.status !== 'ok') throw new Error(listed.status);
    expect(listed.copies.map((copy) => [copy.declarationId, copy.version])).toEqual([
      [id, 2],
      [expect.any(String), 1],
      [expect.any(String), 2],
    ]);
  });

  it('has none for someone who is not a declarant, and is unavailable when the service is down', async () => {
    expect(await listCopies(access(bearer({ realm_access: { roles: ['applicant'] } })))).toEqual({
      status: 'ok',
      copies: [],
    });
    expect(await listCopies(access(DECLARANT, down))).toEqual({ status: 'unavailable' });
  });

  it('downloads an issued copy from documents as its subject', async () => {
    const id = await filedTwice();
    const asked = await requestCopy(
      access(),
      { commission: 'psc', declarationId: id, version: 2 },
      crypto.randomUUID(),
    );
    if (asked.status !== 'ok') throw new Error(asked.status);
    later();
    const issued = await readCopy(access(), asked.copy.id);
    if (issued.status !== 'ok' || !issued.copy.documentId) throw new Error('not issued');

    const link = await readCopyDownload(documents(), issued.copy.documentId);
    expect(link).toEqual({
      status: 'ok',
      downloadUrl: `/api/mock-packages/${issued.copy.documentId}`,
    });
    expect(await readCopyDownload(documents(), crypto.randomUUID())).toEqual({
      status: 'not-found',
    });
  });
});

describe('who accessed my declaration (S12)', () => {
  it('shows Form K requests from notification and law enforcement from the grant', async () => {
    const result = await loadHistory(access());
    if (result.status !== 'ok') throw new Error(result.status);
    const kinds = new Set(result.entries.map((entry) => entry.kind));
    expect(kinds.has('received')).toBe(false);
    expect(kinds.has('verified')).toBe(false);
    expect(kinds.has('cannot-identify')).toBe(false);
    const lea = result.entries.filter((entry) => entry.subjectKind === 'lea-request');
    for (const subject of new Set(lea.map((entry) => entry.subjectId))) {
      expect(
        lea
          .filter((entry) => entry.subjectId === subject)
          .map((entry) => entry.kind)
          .sort(),
      ).toEqual(['decided', 'downloaded', 'expired', 'package-issued'].sort());
    }
    expect(lea.every((entry) => entry.actor === null)).toBe(true);
  });

  it('is newest first, and names no staff', async () => {
    const result = await loadHistory(access());
    if (result.status !== 'ok') throw new Error(result.status);
    const times = result.entries.map((entry) => Date.parse(entry.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const named = result.entries.filter((entry) => entry.actor !== null);
    expect(new Set(named.map((entry) => entry.kind))).toEqual(new Set(['downloaded', 'withdrawn']));
  });

  it('adds a self-access entry for each issued copy', async () => {
    const result = await loadHistory(access());
    if (result.status !== 'ok') throw new Error(result.status);
    const copies = result.entries.filter((entry) => entry.kind === 'self-access');
    expect(copies.map((entry) => entry.certifiedCopy?.id).sort()).toEqual(
      [MOCK_COPY_IDS.online, MOCK_COPY_IDS.representative].sort(),
    );
    expect(
      copies.find((entry) => entry.certifiedCopy?.id === MOCK_COPY_IDS.representative)
        ?.certifiedCopy?.representativeName,
    ).toBe('Mary Kennedy');
  });

  it('is empty for someone who is not a declarant, and unavailable when the service is down', async () => {
    expect(await loadHistory(access(bearer({ realm_access: { roles: ['applicant'] } })))).toEqual({
      status: 'ok',
      entries: [],
    });
    expect(await loadHistory(access(DECLARANT, down))).toEqual({ status: 'unavailable' });
  });
});

describe('loadSubmittedVersions', () => {
  it('lists every submitted version with its declaration, newest first', async () => {
    const id = await filedTwice();
    const result = await loadSubmittedVersions(declarationsClient());
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.versions.map((each) => [each.declarationId, each.version.version])).toEqual([
      [id, 2],
      [id, 1],
    ]);
    expect(result.versions[0]?.commission.slug).toBe('psc');
  });

  it('has none before anything is submitted', async () => {
    await completeDraft();
    expect(await loadSubmittedVersions(declarationsClient())).toEqual({
      status: 'ok',
      versions: [],
    });
  });
});
