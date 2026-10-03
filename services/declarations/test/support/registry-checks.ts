import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { expect } from 'vitest';

import { declarations, outbox } from '../../src/db/schema.js';
import type { SuggestionSet } from '../../src/suggestions/representation.js';
import { contractErrors, okResponse } from './contract.js';
import type { Caller, DeclarationsApi } from './declarations-api.js';

/**
 * Checking registries through the HTTP API as the portal does (spec 05b): give the officer's
 * national ID for the draft's roster record, ask with consent, and poll the list until no set is
 * pending. Suites start the API in `beforeAll`, so the helpers take it through `api()`.
 */

export const CONSENT = { requested: true, textVersion: 'registry-consent-v1' };

const LIST = '/v1/declarations/{declarationId}/suggestions';

export function registryCheckFixtures(api: () => DeclarationsApi) {
  /** The officer (`personId`) of the draft is known to the registries by `nationalId`. */
  async function givenOfficerNationalId(
    personId: string,
    declarationId: string,
    nationalId: string,
  ): Promise<void> {
    const [row] = await api().asPerson(personId, (tx) =>
      tx
        .select({ tenant: declarations.tenant })
        .from(declarations)
        .where(eq(declarations.id, declarationId)),
    );
    if (!row) throw new Error(`No declaration ${declarationId}`);
    api().directory.givenNationalId(row.tenant, personId, nationalId);
  }

  function requestLookups(declarationId: string, body: unknown, caller: Caller) {
    return api().request('POST', `/v1/declarations/${declarationId}/suggestions/lookups`, caller, {
      headers: { 'idempotency-key': randomUUID() },
      body,
    });
  }

  /** The sets once no lookup is pending any more (the workflow has recorded every answer). */
  async function settled(declarationId: string, caller: Caller): Promise<SuggestionSet[]> {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const response = await api().request(
        'GET',
        `/v1/declarations/${declarationId}/suggestions`,
        caller,
      );
      expect(response.statusCode).toBe(200);
      const sets = response.json<SuggestionSet[]>();
      expect(contractErrors(okResponse(LIST, 'get'), sets)).toEqual([]);
      if (sets.every((set) => set.status !== 'pending')) return sets;
      if (Date.now() > deadline) throw new Error(`Still pending: ${JSON.stringify(sets)}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /** Checks `systems` for the person and answers the sets once every registry has answered. */
  async function checked(
    declarationId: string,
    caller: Caller,
    personKey: string,
    systems: string[],
  ): Promise<SuggestionSet[]> {
    const response = await requestLookups(
      declarationId,
      { personKey, systems, consent: CONSENT },
      caller,
    );
    expect(response.statusCode, response.body).toBe(202);
    return settled(declarationId, caller);
  }

  /** The envelopes recorded in the outbox with this event type. */
  async function eventsOf(type: string) {
    const rows = await api()
      .db.select({ envelope: outbox.envelope })
      .from(outbox)
      .where(eq(outbox.eventType, type));
    return rows.map((row) => row.envelope);
  }

  return { givenOfficerNationalId, requestLookups, settled, checked, eventsOf };
}
