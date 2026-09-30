import { hasValidCheckCharacter, parse } from '@adili/numbering/references';
import createClient from 'openapi-fetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadSection, loadSummary, saveSection, startDeclaration } from './declarations.server';
import {
  failNextSubmits,
  MOCK_OBLIGATIONS,
  mockDeclarationsFetch,
  resetDeclarationsMock,
  setSlipIssuance,
} from './declarations/mock.server';
import type { paths } from './declarations/schema.gen';
import { mockDocumentsFetch } from './documents/mock.server';
import type { paths as documentsPaths } from './documents/schema.gen';
import {
  loadSubmission,
  readAcknowledgement,
  readSlipDownload,
  reissueAcknowledgement,
  submitDeclaration,
  type SubmitOutcome,
} from './submission.server';

/** An unsigned JWT with these claims, as the mock reads them. */
function bearer(claims: Record<string, unknown>) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `Bearer ${part({ alg: 'none' })}.${part(claims)}.x`;
}

const NOW = Date.parse('2026-09-30T07:42:00Z');
const PERSON = { person_id: '5b0f7c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b' };
const STEPPED_UP = bearer({ ...PERSON, acr: 'step-up', auth_time: NOW / 1000 - 60 });

function client(authorization = STEPPED_UP) {
  return createClient<paths>({
    baseUrl: 'http://declarations.test',
    fetch: mockDeclarationsFetch,
    headers: { authorization },
  });
}

function documents() {
  return createClient<documentsPaths>({
    baseUrl: 'http://documents.test',
    fetch: mockDocumentsFetch,
    headers: { authorization: STEPPED_UP },
  });
}

let keys = 0;
function key() {
  keys += 1;
  return `00000000-0000-4000-8000-${String(keys).padStart(12, '0')}`;
}

async function save(
  declarationId: string,
  sectionKey: string,
  contents: Parameters<typeof saveSection>[1]['contents'],
) {
  const loaded = await loadSummary(client(), declarationId);
  if (loaded.status !== 'ok') throw new Error(loaded.status);
  const ifMatch = `"${String(loaded.summary.declaration.draftVersion)}"`;
  const outcome = await saveSection(client(), {
    declarationId,
    sectionKey,
    ifMatch,
    contents,
  });
  if (outcome.status !== 'saved') throw new Error(outcome.status);
}

/** A draft for the obligation with every section answered and nothing blocking. */
async function completeDraft(obligationId: string = MOCK_OBLIGATIONS.initial) {
  const started = await startDeclaration(client(), obligationId);
  if (started.status !== 'started') throw new Error(started.status);
  const id = started.declaration.id;
  const bio = await loadSection(client(), id, 'bio');
  if (bio.status !== 'ok') throw new Error(bio.status);
  const officer = bio.section.contents as Record<string, Record<string, unknown>>;
  await save(id, 'bio', {
    ...officer,
    birth: { date: '1980-04-02', place: 'Nyeri' },
    maritalStatus: 'single',
    address: { postal: 'P.O. Box 12-10100, Nyeri', physical: 'Ruringu estate, Nyeri' },
    employment: { ...officer.employment, nature: 'permanent' },
  });
  await save(id, 'household', {
    spouses: { none: true, items: [] },
    children: { none: true, items: [] },
  });
  const statement = await loadSection(client(), id, 'statement:officer');
  if (statement.status !== 'ok') throw new Error(statement.status);
  await save(id, 'statement:officer', {
    ...statement.section.contents,
    incomeNil: true,
    income: [],
    assetsNil: true,
    assets: [],
    liabilitiesNil: true,
    liabilities: [],
  });
  await save(id, 'other', {
    registrableInterests: {
      directorships: [],
      memberships: [],
      dualCitizenship: { holds: false, pendingApplication: false },
      pendingCases: [],
    },
    freeText: '',
  });
  return id;
}

function submittedOf(outcome: SubmitOutcome) {
  if (outcome.status !== 'submitted') throw new Error(outcome.status);
  return outcome.result;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetDeclarationsMock();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the summary says when a declaration can be submitted', () => {
  it('can once nothing blocks and the statement date has come', async () => {
    const id = await completeDraft();

    expect(await loadSummary(client(), id)).toMatchObject({
      status: 'ok',
      summary: {
        canSubmit: true,
        cannotSubmitReason: null,
        valid: true,
        blocking: [],
        late: false,
      },
    });
  });

  it('cannot while something blocks', async () => {
    const started = await startDeclaration(client(), MOCK_OBLIGATIONS.initial);
    if (started.status !== 'started') throw new Error(started.status);

    expect(await loadSummary(client(), started.declaration.id)).toMatchObject({
      status: 'ok',
      summary: { canSubmit: false, cannotSubmitReason: 'incomplete', valid: false },
    });
  });

  it('says a submission after the due date is late', async () => {
    const id = await completeDraft();
    vi.setSystemTime(Date.parse('2026-10-11T07:00:00Z'));

    expect(await loadSummary(client(), id)).toMatchObject({
      status: 'ok',
      summary: {
        declaration: { dueDate: '2026-10-10' },
        canSubmit: true,
        late: true,
      },
    });
  });

  it('cannot once submitted', async () => {
    const id = await completeDraft();
    submittedOf(await submitDeclaration(client(), { declarationId: id, idempotencyKey: key() }));

    expect(await loadSummary(client(), id)).toMatchObject({
      status: 'ok',
      summary: { canSubmit: false, cannotSubmitReason: 'not-a-draft' },
    });
  });

  it('cannot before the statement date, complete or not', async () => {
    const id = await completeDraft(MOCK_OBLIGATIONS.biennial);

    expect(await loadSummary(client(), id)).toMatchObject({
      status: 'ok',
      summary: { canSubmit: false, valid: true, cannotSubmitReason: 'before-statement-date' },
    });
  });
});

describe('submitting (S1, S2)', () => {
  it('files version 1 with a reference, and the success page reads it back', async () => {
    const id = await completeDraft();
    const idempotencyKey = key();

    const result = submittedOf(
      await submitDeclaration(client(), { declarationId: id, idempotencyKey }),
    );

    expect(result).toMatchObject({
      declaration: { id, status: 'submitted' },
      version: {
        version: 1,
        late: false,
        supersededAt: null,
        acknowledgement: { status: 'pending' },
      },
      obligationStatus: 'filed',
    });
    const { reference } = result.version;
    expect(reference).toBe('DCI-PSC-2026-0000001-' + reference.slice(-1));
    expect(hasValidCheckCharacter(reference)).toBe(true);
    expect(parse(reference)).toMatchObject({ scheme: 'DCI', issuer: 'PSC', period: 2026 });

    expect(await loadSubmission(client(), id)).toEqual({
      status: 'ok',
      declaration: result.declaration,
      version: result.version,
    });
  });

  it('answers a replay with the same key with the same 201, and files once', async () => {
    const id = await completeDraft();
    const idempotencyKey = key();

    const first = await submitDeclaration(client(), { declarationId: id, idempotencyKey });
    const replay = await submitDeclaration(client(), { declarationId: id, idempotencyKey });

    expect(replay).toEqual(first);
    const versions = await client().GET('/v1/declarations/{declarationId}/versions', {
      params: { path: { declarationId: id } },
    });
    expect(versions.data).toHaveLength(1);
  });

  it('refuses a second submit of a submitted declaration as not a draft', async () => {
    const id = await completeDraft();
    submittedOf(await submitDeclaration(client(), { declarationId: id, idempotencyKey: key() }));

    expect(await submitDeclaration(client(), { declarationId: id, idempotencyKey: key() })).toEqual(
      { status: 'conflict', code: 'not-a-draft' },
    );
  });

  it('records a submission after the due date as late', async () => {
    const id = await completeDraft();
    const later = Date.parse('2026-10-11T07:00:00Z');
    vi.setSystemTime(later);
    const steppedUp = client(bearer({ ...PERSON, acr: 'step-up', auth_time: later / 1000 }));

    const result = submittedOf(
      await submitDeclaration(steppedUp, { declarationId: id, idempotencyKey: key() }),
    );
    expect(result.version.late).toBe(true);
  });
});

describe('amending in the mock, as the service does (S7, S8)', () => {
  const path = (declarationId: string) => ({ params: { path: { declarationId } } });

  async function submitted() {
    const id = await completeDraft();
    submittedOf(await submitDeclaration(client(), { declarationId: id, idempotencyKey: key() }));
    return id;
  }

  it('reopens version 1, files version 2 under the same reference, and lists both', async () => {
    const id = await submitted();
    const listed = await client().GET('/v1/me/declarations');
    expect(listed.data?.[0]).toMatchObject({
      id,
      status: 'submitted',
      currentVersion: 1,
      amendable: true,
      late: false,
      acknowledgement: { status: 'pending', documentId: null, verifiedCount: 0 },
    });

    const amended = await client().POST('/v1/declarations/{declarationId}/amend', path(id));
    expect(amended.data).toMatchObject({
      status: 'amending',
      currentVersion: 1,
      amendingFromVersion: 1,
    });
    expect((await client().GET('/v1/me/declarations')).data?.[0]).toMatchObject({
      status: 'amending',
      amendable: false,
    });
    await save(id, 'other', {
      registrableInterests: {
        directorships: [],
        memberships: [],
        dualCitizenship: { holds: false, pendingApplication: false },
        pendingCases: [],
      },
      freeText: 'Amended',
    });
    const second = submittedOf(
      await submitDeclaration(client(), { declarationId: id, idempotencyKey: key() }),
    );

    expect(second.version).toMatchObject({ version: 2 });
    expect(second.declaration).toMatchObject({ currentVersion: 2, amendingFromVersion: null });
    const versions = await client().GET('/v1/declarations/{declarationId}/versions', path(id));
    expect(versions.data?.map((version) => version.version)).toEqual([2, 1]);
    expect(versions.data?.[1]?.reference).toBe(second.version.reference);
    expect(versions.data?.[1]?.supersededAt).not.toBeNull();
    const first = await client().GET('/v1/declarations/{declarationId}/versions/{version}', {
      params: { path: { declarationId: id, version: 1 } },
    });
    expect(first.data?.document).toMatchObject({ otherInformation: { freeText: '' } });
  });

  it('refuses to amend after the due date and a draft, and discarding puts version 1 back', async () => {
    const id = await submitted();
    expect(
      (await client().POST('/v1/declarations/{declarationId}/amend', path(id))).data,
    ).toBeTruthy();
    await save(id, 'other', {
      registrableInterests: {
        directorships: [],
        memberships: [],
        dualCitizenship: { holds: false, pendingApplication: false },
        pendingCases: [],
      },
      freeText: 'Changed my mind',
    });

    const discarded = await client().POST(
      '/v1/declarations/{declarationId}/amend/discard',
      path(id),
    );

    expect(discarded.data).toMatchObject({ status: 'submitted', amendingFromVersion: null });
    const summary = await loadSummary(client(), id);
    if (summary.status !== 'ok') throw new Error(summary.status);
    expect(summary.summary.document).toMatchObject({ otherInformation: { freeText: '' } });
    vi.setSystemTime(Date.parse('2026-10-11T07:00:00Z'));
    const closed = await client().POST('/v1/declarations/{declarationId}/amend', path(id));
    expect(closed.response.status).toBe(409);
    expect(closed.error).toMatchObject({ code: 'amendment-window-closed' });
    expect((await client().GET('/v1/me/declarations')).data?.[0]).toMatchObject({
      amendable: false,
    });
    const draft = await completeDraft(MOCK_OBLIGATIONS.biennial);
    const notSubmitted = await client().POST('/v1/declarations/{declarationId}/amend', path(draft));
    expect(notSubmitted.error).toMatchObject({ code: 'not-submitted' });
  });
});

describe('what stops a submit (S3, S4)', () => {
  it('needs a step-up at most five minutes old', async () => {
    const id = await completeDraft();

    const withoutStepUp = client(bearer(PERSON));
    expect(
      await submitDeclaration(withoutStepUp, { declarationId: id, idempotencyKey: key() }),
    ).toEqual({ status: 'step-up-required' });
    const stale = client(bearer({ ...PERSON, acr: 'step-up', auth_time: NOW / 1000 - 360 }));
    expect(await submitDeclaration(stale, { declarationId: id, idempotencyKey: key() })).toEqual({
      status: 'step-up-required',
    });
  });

  it('answers the blocking issues of an incomplete draft', async () => {
    const started = await startDeclaration(client(), MOCK_OBLIGATIONS.initial);
    if (started.status !== 'started') throw new Error(started.status);

    const outcome = await submitDeclaration(client(), {
      declarationId: started.declaration.id,
      idempotencyKey: key(),
    });
    if (outcome.status !== 'incomplete') throw new Error(outcome.status);
    expect(outcome.blocking.length).toBeGreaterThan(0);
    expect(outcome.blocking[0]).toMatchObject({ sectionKey: 'bio' });
  });

  it('refuses before the statement date', async () => {
    const id = await completeDraft(MOCK_OBLIGATIONS.biennial);

    expect(await submitDeclaration(client(), { declarationId: id, idempotencyKey: key() })).toEqual(
      { status: 'conflict', code: 'before-statement-date' },
    );
  });

  it('reads 5xx as unavailable, and the same key files on retry', async () => {
    const id = await completeDraft();
    const idempotencyKey = key();
    failNextSubmits(1);

    expect(await submitDeclaration(client(), { declarationId: id, idempotencyKey })).toEqual({
      status: 'unavailable',
    });
    submittedOf(await submitDeclaration(client(), { declarationId: id, idempotencyKey }));
  });

  it('reads an unknown declaration as not found, and a network failure as unavailable', async () => {
    const declarationId = '9d3c2b1a-0f4e-4d5c-8b7a-6f5e4d3c2b1a';
    expect(await submitDeclaration(client(), { declarationId, idempotencyKey: key() })).toEqual({
      status: 'not-found',
    });
    const offline = createClient<paths>({
      baseUrl: 'http://declarations.test',
      fetch: () => Promise.reject(new Error('offline')),
    });
    expect(await submitDeclaration(offline, { declarationId, idempotencyKey: key() })).toEqual({
      status: 'unavailable',
    });
  });
});

describe('loading a submission for the success page', () => {
  it('says a draft is not submitted yet, and an unknown declaration is not found', async () => {
    const id = await completeDraft();

    expect(await loadSubmission(client(), id)).toEqual({ status: 'not-submitted' });
    expect(await loadSubmission(client(), '9d3c2b1a-0f4e-4d5c-8b7a-6f5e4d3c2b1a')).toEqual({
      status: 'not-found',
    });
  });
});

describe('the acknowledgement slip', () => {
  async function submitted() {
    const declarationId = await completeDraft();
    submittedOf(await submitDeclaration(client(), { declarationId, idempotencyKey: key() }));
    return { declarationId, version: 1 };
  }

  function later(seconds: number) {
    vi.setSystemTime(Date.now() + seconds * 1000);
  }

  it('is pending right after the submit, then issued with a code, verify link and download', async () => {
    const ref = await submitted();

    expect(await readAcknowledgement(client(), ref)).toEqual({
      status: 'ok',
      acknowledgement: {
        status: 'pending',
        documentId: null,
        verificationId: null,
        verifyUrl: null,
        issuedAt: null,
        verifiedCount: 0,
        downloadUrl: null,
      },
    });
    later(4);
    const read = await readAcknowledgement(client(), ref);
    if (read.status !== 'ok') throw new Error(read.status);
    const { acknowledgement } = read;
    expect(acknowledgement).toMatchObject({
      status: 'issued',
      verifiedCount: 0,
      downloadUrl: null,
    });
    expect(acknowledgement.verificationId).toMatch(
      /^ADL-(?:[0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{2}$/,
    );
    expect(acknowledgement.verifyUrl).toBe(
      `http://localhost:3030/v/${acknowledgement.verificationId ?? ''}`,
    );

    // The versions list shows the same slip; it downloads from the documents service.
    const load = await loadSubmission(client(), ref.declarationId);
    if (load.status !== 'ok') throw new Error(load.status);
    expect(load.version.acknowledgement).toEqual(acknowledgement);
    const documentId = acknowledgement.documentId ?? '';
    expect(await readSlipDownload(documents(), documentId)).toEqual({
      status: 'ok',
      downloadUrl: `/api/mock-slips/${documentId}`,
    });
    expect(await readSlipDownload(documents(), '9d3c2b1a-0f4e-4d5c-8b7a-6f5e4d3c2b1a')).toEqual({
      status: 'not-found',
    });
  });

  it('reads failed a minute after the submit when it did not come, and not before', async () => {
    setSlipIssuance('fail');
    const ref = await submitted();
    expect(await reissueAcknowledgement(client(), ref)).toEqual({ status: 'in-progress' });
    later(60);
    expect(await readAcknowledgement(client(), ref)).toMatchObject({
      acknowledgement: { status: 'pending' },
    });
    expect(await reissueAcknowledgement(client(), ref)).toEqual({ status: 'in-progress' });
    later(1);
    expect(await readAcknowledgement(client(), ref)).toMatchObject({
      acknowledgement: { status: 'failed' },
    });
    const load = await loadSubmission(client(), ref.declarationId);
    expect(load).toMatchObject({ version: { acknowledgement: { status: 'failed' } } });
  });

  it('can be asked for again when it failed, with a cooldown until that ask is due', async () => {
    setSlipIssuance('fail');
    const ref = await submitted();
    later(61);

    expect(await reissueAcknowledgement(client(), ref)).toEqual({ status: 'requested' });
    expect(await readAcknowledgement(client(), ref)).toMatchObject({
      acknowledgement: { status: 'pending' },
    });
    later(4);
    expect(await reissueAcknowledgement(client(), ref)).toEqual({
      status: 'cooldown',
      retryAfterSeconds: 56,
    });
    later(57);
    expect(await readAcknowledgement(client(), ref)).toMatchObject({
      acknowledgement: { status: 'failed' },
    });

    setSlipIssuance('issue');
    expect(await reissueAcknowledgement(client(), ref)).toEqual({ status: 'requested' });
    later(4);
    expect(await readAcknowledgement(client(), ref)).toMatchObject({
      acknowledgement: { status: 'issued' },
    });
    expect(await reissueAcknowledgement(client(), ref)).toEqual({ status: 'in-progress' });
  });

  it('reads an unknown version as not found, and a network failure as unavailable', async () => {
    const ref = await submitted();

    expect(await readAcknowledgement(client(), { ...ref, version: 2 })).toEqual({
      status: 'not-found',
    });
    expect(await reissueAcknowledgement(client(), { ...ref, version: 2 })).toEqual({
      status: 'not-found',
    });
    const offline = createClient<paths>({
      baseUrl: 'http://declarations.test',
      fetch: () => Promise.reject(new Error('offline')),
    });
    expect(await readAcknowledgement(offline, ref)).toEqual({ status: 'unavailable' });
    expect(await reissueAcknowledgement(offline, ref)).toEqual({ status: 'unavailable' });
  });
});
