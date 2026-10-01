import createClient from 'openapi-fetch';

import {
  loadSection,
  loadSummary,
  saveSection,
  startDeclaration,
} from '../server/declarations.server';
import { MOCK_OBLIGATIONS, mockDeclarationsFetch } from '../server/declarations/mock.server';
import type { paths } from '../server/declarations/schema.gen';
import { mockDocumentsFetch } from '../server/documents/mock.server';
import type { paths as documentsPaths } from '../server/documents/schema.gen';

/**
 * A declarant calling the in-memory declarations and documents mocks, for the BFF modules'
 * tests: an unsigned token, a client per call, and a complete draft ready to submit.
 */

/** An unsigned JWT with these claims, as the mocks read them. */
export function bearer(claims: Record<string, unknown>) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `Bearer ${part({ alg: 'none' })}.${part(claims)}.x`;
}

export const PERSON = { person_id: '5b0f7c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b' };

/** A token with a step-up `seconds` old at `now` (the mock's clock, so fake timers apply). */
export function steppedUp(now: number = Date.now(), seconds = 60) {
  return bearer({ ...PERSON, acr: 'step-up', auth_time: now / 1000 - seconds });
}

/** The declarations mock as the declarant; stepped up a minute ago unless told otherwise. */
export function declarationsClient(authorization: string = steppedUp()) {
  return createClient<paths>({
    baseUrl: 'http://declarations.test',
    fetch: mockDeclarationsFetch,
    headers: { authorization },
  });
}

export function documentsClient(authorization: string = steppedUp()) {
  return createClient<documentsPaths>({
    baseUrl: 'http://documents.test',
    fetch: mockDocumentsFetch,
    headers: { authorization },
  });
}

let keys = 0;
/** A fresh Idempotency-Key. */
export function idempotencyKey() {
  keys += 1;
  return `00000000-0000-4000-8000-${String(keys).padStart(12, '0')}`;
}

export async function save(
  declarationId: string,
  sectionKey: string,
  contents: Parameters<typeof saveSection>[1]['contents'],
  authorization: string = steppedUp(),
) {
  const client = declarationsClient(authorization);
  const loaded = await loadSummary(client, declarationId);
  if (loaded.status !== 'ok') throw new Error(loaded.status);
  const ifMatch = `"${String(loaded.summary.declaration.draftVersion)}"`;
  const outcome = await saveSection(client, { declarationId, sectionKey, ifMatch, contents });
  if (outcome.status !== 'saved') throw new Error(outcome.status);
}

/**
 * A draft for the obligation with every section answered and nothing blocking, started as the
 * declarant `authorization` is (the default declarant unless told otherwise).
 */
export async function completeDraft(
  obligationId: string = MOCK_OBLIGATIONS.initial,
  authorization: string = steppedUp(),
) {
  const client = declarationsClient(authorization);
  const started = await startDeclaration(client, obligationId);
  if (started.status !== 'started') throw new Error(started.status);
  const id = started.declaration.id;
  const bio = await loadSection(client, id, 'bio');
  if (bio.status !== 'ok') throw new Error(bio.status);
  const bioContents = bio.section.contents as Record<string, Record<string, unknown>>;
  await save(
    id,
    'bio',
    {
      ...bioContents,
      birth: { date: '1980-04-02', place: 'Nyeri' },
      maritalStatus: 'single',
      address: { postal: 'P.O. Box 12-10100, Nyeri', physical: 'Ruringu estate, Nyeri' },
      employment: { ...bioContents.employment, nature: 'permanent' },
    },
    authorization,
  );
  await save(
    id,
    'household',
    {
      spouses: { none: true, items: [] },
      children: { none: true, items: [] },
    },
    authorization,
  );
  const statement = await loadSection(client, id, 'statement:officer');
  if (statement.status !== 'ok') throw new Error(statement.status);
  await save(
    id,
    'statement:officer',
    {
      ...statement.section.contents,
      incomeNil: true,
      income: [],
      assetsNil: true,
      assets: [],
      liabilitiesNil: true,
      liabilities: [],
    },
    authorization,
  );
  await save(
    id,
    'other',
    {
      registrableInterests: {
        directorships: [],
        memberships: [],
        dualCitizenship: { holds: false, pendingApplication: false },
        pendingCases: [],
      },
      freeText: '',
    },
    authorization,
  );
  return id;
}
