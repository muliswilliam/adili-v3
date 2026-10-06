import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { commissionRefs, outbox, suggestionConsents } from '../../src/db/schema.js';
import type { SuggestionSet } from '../../src/suggestions/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type DeclarationsApi, startDeclarationsApi } from '../support/declarations-api.js';
import { CONSENT } from '../support/registry-checks.js';
import { submissionFixtures } from '../support/submission.js';

/**
 * Spec 05b S2 over HTTP, with Temporal faked (`FakeTemporal`): the lookup workflow is started
 * inside the transaction that records the request (ADR-003 decision 7, #530), so when it cannot
 * be started the request is refused (503 `workflow-unavailable`) and nothing is recorded: no
 * consent, no set, no event. The declarant asks again.
 */

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
  it('answers 503 and records nothing: no consent, no set, no event', async () => {
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

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'workflow-unavailable', status: 503 });
    const listed = await api.request(
      'GET',
      `/v1/declarations/${draft.id}/suggestions`,
      declarant(ACHIENG),
    );
    const sets = listed.json<SuggestionSet[]>();
    expect(contractErrors(okResponse(LIST, 'get'), sets)).toEqual([]);
    expect(sets).toEqual([]);
    expect(await api.db.select().from(suggestionConsents)).toEqual([]);
    expect(api.gateway.calls).toEqual([]);
    const requested = await api.db.select({ type: outbox.eventType }).from(outbox);
    expect(requested.map((row) => row.type)).not.toContain('declaration.lookup-requested.v1');
  });
});
