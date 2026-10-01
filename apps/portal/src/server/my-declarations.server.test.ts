import createClient from 'openapi-fetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageSize } from '../declaration/my-declarations';
import {
  completeDraft,
  declarationsClient as client,
  idempotencyKey as key,
  save,
} from '../test/declarant';
import { loadSection, startDeclaration } from './declarations.server';
import { MOCK_OBLIGATIONS, resetDeclarationsMock } from './declarations/mock.server';
import type { paths } from './declarations/schema.gen';
import {
  amendDeclaration,
  discardAmendment,
  type FiledDeclaration,
  loadMyDeclarations,
  loadVersions,
  type MyDeclarationsPage,
} from './my-declarations.server';
import { submitDeclaration } from './submission.server';

const NOW = Date.parse('2026-09-30T07:42:00Z');
/** The day after the initial obligation's due date (10 Oct 2026), in Kenya. */
const AFTER_DUE = Date.parse('2026-10-10T21:30:00Z');
const UNKNOWN = '9d3c2b1a-0f4e-4d5c-8b7a-6f5e4d3c2b1a';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetDeclarationsMock();
});

afterEach(() => {
  vi.useRealTimers();
});

async function submit(declarationId: string) {
  const outcome = await submitDeclaration(client(), { declarationId, idempotencyKey: key() });
  if (outcome.status !== 'submitted') throw new Error(outcome.status);
  return outcome.result;
}

async function submitted() {
  const id = await completeDraft();
  await submit(id);
  return id;
}

async function page(number = 1, pageSize: PageSize = 5): Promise<MyDeclarationsPage> {
  const loaded = await loadMyDeclarations(client(), { page: number, pageSize });
  if (loaded.status !== 'ok') throw new Error(loaded.status);
  return loaded;
}

async function filed(id: string): Promise<FiledDeclaration> {
  const row = (await page()).rows.find((entry) => entry.declaration.id === id);
  if (row?.kind !== 'filed') throw new Error(`${id} is not filed`);
  return row.declaration;
}

async function versionsOf(id: string) {
  const loaded = await loadVersions(client(), id);
  if (loaded.status !== 'ok') throw new Error(loaded.status);
  return loaded.versions;
}

async function officerStatement(id: string) {
  const section = await loadSection(client(), id, 'statement:officer');
  if (section.status !== 'ok') throw new Error(section.status);
  return section.section.contents;
}

describe('my declarations', () => {
  it('lists drafts first, and filed declarations with the version in force', async () => {
    const filedId = await submitted();
    const draft = await startDeclaration(client(), MOCK_OBLIGATIONS.biennial);
    if (draft.status !== 'started') throw new Error(draft.status);

    const loaded = await page();

    expect(loaded).toMatchObject({ status: 'ok', page: 1, pageSize: 5, total: 2 });
    expect(loaded.rows.map((row) => row.kind)).toEqual(['draft', 'filed']);
    const declaration = await filed(filedId);
    expect(declaration).toMatchObject({
      status: 'submitted',
      dueDate: '2026-10-10',
      currentVersion: 1,
      amendingFromVersion: null,
      late: false,
      amendable: true,
      acknowledgement: { status: 'pending', documentId: null, verifiedCount: 0 },
      commission: { issuerCode: 'PSC' },
      type: 'initial',
    });
    expect(declaration.reference).toMatch(/^DCI-PSC-2026-0000001-/);
  });

  it('says amendments are closed after the due date', async () => {
    const id = await submitted();
    vi.setSystemTime(AFTER_DUE);

    expect((await filed(id)).amendable).toBe(false);
  });

  it('pages the list and clamps a page past the end to the last one', async () => {
    await submitted();
    await completeDraft(MOCK_OBLIGATIONS.biennial);

    expect((await page(1, 5)).rows).toHaveLength(2);
    expect(await page(4, 5)).toMatchObject({ page: 1, total: 2 });
  });

  it('has none when there are none, and reads a failure as unavailable', async () => {
    expect(await loadMyDeclarations(client(), { page: 1, pageSize: 5 })).toEqual({
      status: 'ok',
      rows: [],
      page: 1,
      pageSize: 5,
      total: 0,
    });
    const offline = createClient<paths>({
      baseUrl: 'http://declarations.test',
      fetch: () => Promise.reject(new Error('offline')),
    });
    expect(await loadMyDeclarations(offline, { page: 1, pageSize: 5 })).toEqual({
      status: 'unavailable',
    });
    expect(await loadVersions(offline, UNKNOWN)).toEqual({ status: 'unavailable' });
    expect(await loadVersions(client(), UNKNOWN)).toEqual({ status: 'not-found' });
  });
});

describe('amending (S7)', () => {
  it('reopens the version in force, and submitting files version 2 with the same reference', async () => {
    const id = await submitted();

    expect(await amendDeclaration(client(), id)).toMatchObject({
      status: 'amending',
      declaration: { id, status: 'amending', amendingFromVersion: 1, currentVersion: 1 },
    });
    expect((await officerStatement(id)).incomeNil).toBe(true);
    expect(await filed(id)).toMatchObject({ status: 'amending', amendable: false });
    await submit(id);

    const declaration = await filed(id);
    expect(declaration).toMatchObject({ status: 'submitted', currentVersion: 2 });
    const [v2, v1] = await versionsOf(id);
    expect(v2).toMatchObject({ version: 2, reference: declaration.reference, supersededAt: null });
    expect(v1).toMatchObject({ version: 1, reference: declaration.reference });
    expect(v1?.supersededAt).toEqual(expect.any(String));
  });

  it('refuses after the due date and a draft, and answers not found for an unknown one', async () => {
    const id = await submitted();
    const draft = await completeDraft(MOCK_OBLIGATIONS.biennial);

    expect(await amendDeclaration(client(), draft)).toEqual({
      status: 'conflict',
      code: 'not-submitted',
    });
    vi.setSystemTime(AFTER_DUE);
    expect(await amendDeclaration(client(), id)).toEqual({
      status: 'conflict',
      code: 'amendment-window-closed',
    });
    expect(await amendDeclaration(client(), UNKNOWN)).toEqual({ status: 'not-found' });
  });
});

describe('discarding an amendment (S8)', () => {
  it('puts the version in force back, untouched', async () => {
    const id = await submitted();
    await amendDeclaration(client(), id);
    await save(id, 'statement:officer', { ...(await officerStatement(id)), incomeNil: false });

    expect(await discardAmendment(client(), id)).toMatchObject({
      status: 'discarded',
      declaration: { status: 'submitted', amendingFromVersion: null, currentVersion: 1 },
    });
    expect(await versionsOf(id)).toMatchObject([{ version: 1, supersededAt: null }]);
    await amendDeclaration(client(), id);
    expect((await officerStatement(id)).incomeNil).toBe(true);
  });

  it('refuses a draft, and answers not found for an unknown one', async () => {
    const draft = await completeDraft(MOCK_OBLIGATIONS.biennial);

    expect(await discardAmendment(client(), draft)).toEqual({ status: 'not-amending' });
    expect(await discardAmendment(client(), UNKNOWN)).toEqual({ status: 'not-found' });
  });
});
