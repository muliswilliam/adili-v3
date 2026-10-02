import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { commissionRefs, outbox } from '../../src/db/schema.js';
import type { SuggestionSet } from '../../src/suggestions/representation.js';
import { contractErrors, okResponse, responseBody } from '../support/contract.js';
import { type DeclarationsApi, startDeclarationsApi } from '../support/declarations-api.js';
import { CONSENT } from '../support/registry-checks.js';
import { submissionFixtures } from '../support/submission.js';

/**
 * Spec 05b S2 over HTTP, with Temporal faked (`FakeTemporal`): when the lookup workflow cannot be
 * started, nothing would ever answer the request's sets, so they are answered `failed` at once
 * rather than left pending. The consent and the request stay recorded.
 */

const LOOKUPS = '/v1/declarations/{declarationId}/suggestions/lookups';
const LIST = '/v1/declarations/{declarationId}/suggestions';
const ACHIENG = randomUUID();

let api: DeclarationsApi;
const { declarant, givenObligation, started } = submissionFixtures(() => api);

beforeAll(async () => {
  api = await startDeclarationsApi({ workflows: 'fake' });
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  await api.asPlatform((tx) =>
    tx
      .insert(commissionRefs)
      .values({ slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' }),
  );
});

describe('a lookup workflow that cannot be started (S2)', () => {
  it('answers and lists the sets failed, asking no registry', async () => {
    const draft = await started(ACHIENG, await givenObligation(ACHIENG));
    api.temporal.down = true;

    const response = await api.request(
      'POST',
      `/v1/declarations/${draft.id}/suggestions/lookups`,
      declarant(ACHIENG),
      {
        headers: { 'idempotency-key': randomUUID() },
        body: { personKey: 'officer', systems: ['kra', 'ntsa'], consent: CONSENT },
      },
    );

    expect(response.statusCode).toBe(202);
    const answered = response.json<SuggestionSet[]>();
    expect(contractErrors(responseBody(LOOKUPS, 'post', 202), answered)).toEqual([]);
    expect(answered.map((set) => [set.source, set.status])).toEqual([
      ['kra', 'failed'],
      ['ntsa', 'failed'],
    ]);
    const listed = await api.request(
      'GET',
      `/v1/declarations/${draft.id}/suggestions`,
      declarant(ACHIENG),
    );
    const sets = listed.json<SuggestionSet[]>();
    expect(contractErrors(okResponse(LIST, 'get'), sets)).toEqual([]);
    expect(sets.map((set) => [set.id, set.status])).toEqual(
      answered.map((set) => [set.id, 'failed']),
    );
    expect(api.gateway.calls).toEqual([]);
    const requested = await api.db.select({ type: outbox.eventType }).from(outbox);
    expect(requested.map((row) => row.type)).toContain('declaration.lookup-requested.v1');
  });
});
