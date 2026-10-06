import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { commissionRefs, outbox, suggestionConsents } from '../../src/db/schema.js';
import type { SuggestionSet } from '../../src/suggestions/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type DeclarationsApi, startDeclarationsApi } from '../support/declarations-api.js';
import { CONSENT } from '../support/registry-checks.js';
import { submissionFixtures } from '../support/submission.js';

/**
 * Starting a lookup request's workflow, over HTTP with Temporal faked (`FakeTemporal`): it is
 * started inside the transaction that records the request, before that transaction takes the
 * declaration's lock (ADR-003 decision 7), so when it cannot be started the request is refused
 * (503 `workflow-unavailable`) and nothing is recorded: no consent, no set, no event. The
 * declarant asks again.
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

describe('starting the lookup workflow', () => {
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

  const asked = (declarationId: string) =>
    api.request(
      'POST',
      `/v1/declarations/${declarationId}/suggestions/lookups`,
      declarant(ACHIENG),
      {
        headers: { 'idempotency-key': randomUUID() },
        body: { personKey: 'officer', systems: ['kra'], consent: CONSENT },
      },
    );

  /**
   * Runs `statement` on the declaration from another connection, as its declarant, giving up
   * after a second if the row is locked: whether it went through.
   */
  async function asideOnDeclaration(statement: string, declarationId: string): Promise<boolean> {
    const client = await api.db.$client.connect();
    try {
      await client.query('begin');
      await client.query(
        "select set_config('app.person', $1, true), set_config('app.subject', $1, true)",
        [ACHIENG],
      );
      await client.query("set local lock_timeout = '1s'");
      const result = await client.query(statement, [declarationId]);
      await client.query('commit');
      return result.rowCount === 1;
    } catch {
      await client.query('rollback');
      return false;
    } finally {
      client.release();
    }
  }

  it('holds no lock on the declaration while the workflow is started', async () => {
    const draft = await started(ACHIENG, await givenObligation(ACHIENG));
    let lockable: boolean | undefined;
    api.temporal.onStart(async () => {
      lockable = await asideOnDeclaration(
        'select id from declarations where id = $1 for update nowait',
        draft.id,
      );
    });

    const response = await asked(draft.id);

    expect(response.statusCode).toBe(202);
    expect(lockable).toBe(true);
  });

  it('refuses the request (409) and records nothing when it is submitted while the workflow starts', async () => {
    const draft = await started(ACHIENG, await givenObligation(ACHIENG));
    api.temporal.onStart(async () => {
      const submitted = await asideOnDeclaration(
        "update declarations set status = 'submitted' where id = $1",
        draft.id,
      );
      if (!submitted) throw new Error('The declaration could not be submitted meanwhile');
    });

    const response = await asked(draft.id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ type: 'declaration-not-draft' });
    expect(await api.db.select().from(suggestionConsents)).toEqual([]);
  });
});
