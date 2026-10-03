import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { expect } from 'vitest';

import type {
  AssistantConversation,
  AssistantMessage,
} from '../../src/assistant/representation.js';
import { filingObligations, outbox, rosterSnapshots } from '../../src/db/schema.js';
import type { Declaration } from '../../src/drafts/representation.js';
import { assetItem, household, incomeItem } from '../fixtures/sections.js';
import type { Caller, DeclarationsApi } from './declarations-api.js';
import { contractErrors } from './contract.js';
import { rosterRecord } from './fake-directory.js';

/**
 * Ask Adili through the HTTP API as a declarant would (spec 11): a due biennial obligation, a
 * draft with a household and the officer's statement saved with a vehicle whose value is still
 * missing, the conversation and the questions asked in it. Suites start the API in `beforeAll`,
 * so the helpers take it through `api()`; `declarant` is whose they are by default.
 */

export const declarantCaller = (personId: string): Caller => ({
  personId,
  sub: personId,
  roles: ['declarant'],
});

export interface Frame {
  event: string;
  data: unknown;
}

/** The server-sent events of a response body, comments (`: ping`) left out. */
export function framesOf(body: string): Frame[] {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('event: '))
    .map((chunk) => {
      const event = /^event: (.+)$/m.exec(chunk)?.[1] ?? '';
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      return { event, data: JSON.parse(data ?? 'null') as unknown };
    });
}

/** The stored answer the stream ended with, checked against the contract's `AssistantAnswer`. */
export function finalOf(body: string): { question: AssistantMessage; answer: AssistantMessage } {
  const final = framesOf(body).find((frame) => frame.event === 'final');
  if (!final) throw new Error(`No final frame in ${body}`);
  expect(contractErrors('/components/schemas/AssistantAnswer', final.data)).toEqual([]);
  return final.data as { question: AssistantMessage; answer: AssistantMessage };
}

export function assistantFixtures(api: () => DeclarationsApi, declarant: string) {
  const caller = declarantCaller(declarant);

  /** A due biennial obligation of the person's (at the PSC by default), with its roster record. */
  async function givenObligation(personId = declarant, tenant = 'psc'): Promise<string> {
    const record = rosterRecord(tenant, { personId, fullName: 'Achieng Wambui Otieno' });
    api().directory.givenRecords([record]);
    const obligationId = randomUUID();
    await api().asPlatform(async (tx) => {
      await tx.insert(rosterSnapshots).values({
        rosterRecordId: record.id,
        tenant,
        personnelFileNumber: record.personnelFileNumber,
        fullName: record.fullName,
        state: 'onboarded',
        appointmentDate: record.appointmentDate,
        personId,
        sourceUpdatedAt: new Date(),
      });
      await tx.insert(filingObligations).values({
        id: obligationId,
        tenant,
        rosterRecordId: record.id,
        personId,
        type: 'biennial',
        cycleKey: 'biennial:2027',
        statementDate: '2027-11-01',
        dueDate: '2027-12-31',
        status: 'due',
        policyVersionId: randomUUID(),
        policyVersion: 1,
        reminderOffsetsDays: [30, 14, 7],
      });
    });
    return obligationId;
  }

  async function save(
    draft: Declaration,
    sectionKey: string,
    body: unknown,
    as: Caller = caller,
  ): Promise<void> {
    const current = (await api().get(`/v1/declarations/${draft.id}`, as)).json<Declaration>();
    const response = await api().request(
      'PUT',
      `/v1/declarations/${draft.id}/sections/${sectionKey}`,
      as,
      { headers: { 'if-match': `"${String(current.draftVersion)}"` }, body },
    );
    expect(response.statusCode, `${sectionKey}: ${response.body}`).toBe(200);
  }

  /**
   * The person's draft with a spouse and a child, and their own statement saved with a vehicle
   * whose value is still missing: a residual at `/assets/0/value`.
   */
  async function givenDraft(as: Caller = caller, personId = declarant): Promise<Declaration> {
    const obligationId = await givenObligation(personId);
    const started = await api().request('POST', `/v1/obligations/${obligationId}/declaration`, as);
    expect(started.statusCode).toBe(201);
    const draft = started.json<Declaration>();
    await save(draft, 'household', household(), as);
    const withoutValue: Partial<ReturnType<typeof assetItem>> = assetItem();
    delete withoutValue.value;
    await save(
      draft,
      'statement:officer',
      {
        incomeNil: false,
        income: [incomeItem()],
        assetsNil: false,
        assets: [withoutValue],
        liabilitiesNil: true,
        liabilities: [],
      },
      as,
    );
    return draft;
  }

  function open(declarationId: string | null, language: 'en' | 'sw' = 'en', as = caller) {
    return api().request('POST', '/v1/me/assistant/conversations', as, {
      body: { declarationId, language },
    });
  }

  async function opened(declarationId: string | null, language: 'en' | 'sw' = 'en', as = caller) {
    const response = await open(declarationId, language, as);
    expect(response.statusCode).toBe(200);
    return response.json<AssistantConversation>();
  }

  function ask(
    conversationId: string,
    text: string,
    sectionKey: string | null = 'statement:officer',
    as = caller,
    extra: Record<string, unknown> = {},
  ) {
    return api().request('POST', `/v1/me/assistant/conversations/${conversationId}/messages`, as, {
      body: { text, sectionKey, ...extra },
    });
  }

  async function eventsOf(type: string) {
    const rows = await api()
      .db.select({ envelope: outbox.envelope })
      .from(outbox)
      .where(eq(outbox.eventType, type));
    return rows.map((row) => row.envelope);
  }

  return { caller, givenObligation, save, givenDraft, open, opened, ask, eventsOf };
}
