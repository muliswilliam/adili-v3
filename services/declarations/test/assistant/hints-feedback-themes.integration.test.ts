import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AssistantMessage } from '../../src/assistant/representation.js';
import {
  assistantMessages,
  assistantThemeCounts,
  commissionRefs,
  filingObligations,
} from '../../src/db/schema.js';
import { assistantFixtures, declarantCaller, finalOf } from '../support/assistant.js';
import { contractErrors, responseBody } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { answerLabel, writingHints } from '../support/fake-ai-gateway.js';
import { DUE_DAY, submissionFixtures } from '../support/submission.js';
import { SPOUSE_ID } from '../fixtures/sections.js';

/**
 * Spec 11 over HTTP (#339): summary hints from the ai-gateway's hints mode (faked), cached by
 * residual set, beneath the deterministic text that is always there (S5); declarants' ratings of
 * answers, forwarded to the gateway's job (S8); and the anonymised question counts per
 * Commission, month and theme, with the unanswered ones (S8).
 */

const ACHIENG = randomUUID();
const achieng = declarantCaller(ACHIENG);
const admin: Caller = { tenant: 'psc', roles: ['commission-admin'] };
const officer: Caller = { tenant: 'psc', roles: ['reporting-officer'] };

const HINTS_BODY = responseBody('/v1/declarations/{declarationId}/hints', 'get', 200);
const FEEDBACK_BODY = responseBody(
  '/v1/me/assistant/conversations/{conversationId}/messages/{messageId}/feedback',
  'put',
  200,
);
const THEMES_BODY = responseBody('/v1/commissions/{slug}/help/themes', 'get', 200);

const VEHICLE_QUESTION = 'Do I declare a matatu I co-own with my brother?';
const SALARY_QUESTION = "Do I declare my wife's salary?";
const OFF_CORPUS_QUESTION = 'What is the capital of France?';

let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  await api.asPlatform(async (tx) => {
    await tx.insert(commissionRefs).values([
      { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
      { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' },
    ]);
  });
  api.directory.givenStaff('psc', 'reporting-officer', [
    { subject: randomUUID(), name: 'Mary Wanjiku', email: 'mary.wanjiku@psc.go.ke' },
  ]);
});

const { givenObligation, givenDraft, save, opened, ask, eventsOf } = assistantFixtures(
  () => api,
  ACHIENG,
);
const filing = submissionFixtures(() => api);

function hints(declarationId: string, language = 'en', caller = achieng) {
  return api.get(`/v1/declarations/${declarationId}/hints?language=${language}`, caller);
}

interface HintRow {
  sectionKey: string;
  path: string;
  code: string;
  message: string;
  hint: string | null;
}

interface Hints {
  status: 'ready' | 'pending' | 'unavailable';
  label: { aiAssisted: true; task: string } | null;
  residuals: HintRow[];
}

async function hinted(declarationId: string, language = 'en'): Promise<Hints> {
  const response = await hints(declarationId, language);
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json<Hints>();
  expect(contractErrors(HINTS_BODY, body)).toEqual([]);
  return body;
}

async function summaryBlocking(declarationId: string) {
  const summary = await api.get(`/v1/declarations/${declarationId}/summary`, achieng);
  return summary.json<{ blocking: Omit<HintRow, 'hint'>[] }>().blocking;
}

describe('summary hints (S5)', () => {
  it('gives each residual an AI hint beneath its deterministic text, asking the gateway in hints mode', async () => {
    const draft = await givenDraft();

    const body = await hinted(draft.id);

    const blocking = await summaryBlocking(draft.id);
    expect(body.status).toBe('ready');
    expect(body.label).toMatchObject({ aiAssisted: true, task: 'answer-declarant-question' });
    expect(body.residuals).toEqual(
      blocking.map((issue) => ({ ...issue, hint: expect.any(String) as string })),
    );
    expect(body.residuals).toContainEqual(
      expect.objectContaining({
        sectionKey: 'statement:officer',
        path: '/assets/0/value',
        hint: 'Hint: required at /assets/0/value',
      }),
    );
    // The spouse's statement is still to do: its hint comes back under the spouse's own key.
    expect(body.residuals).toContainEqual(
      expect.objectContaining({
        sectionKey: `statement:spouse:${SPOUSE_ID}`,
        code: 'section-not-started',
        hint: 'Hint: section-not-started at',
      }),
    );

    const [sent] = api.aiGateway.hintRequests;
    expect(sent?.request).toMatchObject({
      tenant: 'psc',
      subjectRef: `declaration:${draft.id}`,
      promptVersion: 1,
      input: {
        kind: 'answer-declarant-question',
        mode: 'hints',
        language: 'en',
        question: null,
        passages: [],
        history: [],
        context: {
          declarationType: 'biennial',
          statementDate: null,
          householdCounts: { spouses: 1, children: 1 },
          sectionKey: null,
        },
      },
    });
    const sentText = JSON.stringify(sent?.request.input);
    // Persons go by their place in the residuals, never by their key.
    expect(sentText).not.toContain(SPOUSE_ID);
    expect(sent?.request.input.context.residuals).toContainEqual({
      sectionKey: 'statement:spouse:00000000-0000-4000-8000-000000000001',
      ruleId: 'section-not-started',
      fieldPath: '',
    });
    for (const secret of ['Toyota Prado', 'Otieno', 'Grace', 'Achieng', '2027-11-01', ACHIENG]) {
      expect(sentText).not.toContain(secret);
    }
    expect(api.aiGateway.requests).toEqual([]);
  });

  it('serves hints already written for the same residuals from the cache, whoever asks', async () => {
    const first = await givenDraft();
    await hinted(first.id);
    const otherPerson = randomUUID();
    const other = await givenDraft(declarantCaller(otherPerson), otherPerson);

    const again = await hinted(first.id);
    const theirs = await api.get(
      `/v1/declarations/${other.id}/hints?language=en`,
      declarantCaller(otherPerson),
    );

    expect(api.aiGateway.hintRequests).toHaveLength(1);
    expect(again.status).toBe('ready');
    expect(again.residuals.every((row) => row.hint !== null)).toBe(true);
    const theirHints = theirs.json<Hints>();
    expect(theirHints.residuals.map((row) => row.hint)).toEqual(
      again.residuals.map((row) => row.hint),
    );
  });

  it('writes Swahili hints apart from English ones', async () => {
    const draft = await givenDraft();
    await hinted(draft.id);

    const sw = await hinted(draft.id, 'sw');

    expect(api.aiGateway.hintRequests.map(({ request }) => request.input.language)).toEqual([
      'en',
      'sw',
    ]);
    expect(sw.residuals[0]?.hint).toMatch(/^Kidokezo: /);
  });

  it('writes new hints when the residuals change', async () => {
    const draft = await givenDraft();
    await hinted(draft.id);

    await save(draft, 'statement:officer', {
      incomeNil: true,
      income: [],
      assetsNil: true,
      assets: [],
      liabilitiesNil: true,
      liabilities: [],
    });
    const after = await hinted(draft.id);

    expect(api.aiGateway.hintRequests).toHaveLength(2);
    expect(after.residuals.map((row) => row.path)).not.toContain('/assets/0/value');
  });

  it('keeps the deterministic text only when the gateway is unavailable or the job fails, caching nothing', async () => {
    api.clock.setToday(DUE_DAY);
    const draft = await givenDraft();
    const blocking = await summaryBlocking(draft.id);

    for (const kind of ['unavailable', 'failed'] as const) {
      api.aiGateway.hints(() => ({ kind }));
      const body = await hinted(draft.id);
      expect(body).toEqual({
        status: 'unavailable',
        label: null,
        residuals: blocking.map((issue) => ({ ...issue, hint: null })),
      });
    }

    // A failed job is its key's for good: the next hour asks again, with a new key.
    api.clock.advance(60 * 60 * 1000);
    api.aiGateway.hints((input) => ({ kind: 'succeeded', output: writingHints(input) }));
    expect((await hinted(draft.id)).status).toBe('ready');
    const keys = api.aiGateway.hintRequests.map((each) => each.idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('answers pending while the job is still running after the wait, and the hints once it is done', async () => {
    api.clock.setToday(DUE_DAY);
    const draft = await givenDraft();
    api.aiGateway.hints(() => ({ kind: 'running' }));

    const pending = await hinted(draft.id);

    expect(pending.status).toBe('pending');
    expect(pending.residuals.every((row) => row.hint === null)).toBe(true);
    api.aiGateway.hints((input) => ({ kind: 'succeeded', output: writingHints(input) }));
    const ready = await hinted(draft.id);
    expect(ready.status).toBe('ready');
    // The second load asks for the same job again: the key names the request, not the load.
    const [firstKey, secondKey] = api.aiGateway.hintRequests.map((each) => each.idempotencyKey);
    expect(secondKey).toBe(firstKey);
  });

  it('ignores hints that are not one per residual, in order', async () => {
    const draft = await givenDraft();
    api.aiGateway.hints((input) => {
      const output = writingHints(input);
      return { kind: 'succeeded', output: { ...output, blocks: output.blocks.slice(1) } };
    });

    const body = await hinted(draft.id);

    expect(body.status).toBe('unavailable');
    expect(body.residuals.every((row) => row.hint === null)).toBe(true);
  });

  it('asks nothing of the gateway for a draft with nothing left to complete', async () => {
    api.clock.setToday(DUE_DAY);
    const personId = randomUUID();
    const draft = await filing.completeDraft(personId);

    const response = await api.get(
      `/v1/declarations/${draft.id}/hints?language=en`,
      filing.declarant(personId),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready', label: null, residuals: [] });
    expect(api.aiGateway.hintRequests).toEqual([]);
  });

  it("answers 404 for another person's draft and for staff, and 400 without a language", async () => {
    const draft = await givenDraft();

    expect((await hints(draft.id, 'en', declarantCaller(randomUUID()))).statusCode).toBe(404);
    expect((await hints(draft.id, 'en', admin)).statusCode).toBe(404);
    expect((await hints(randomUUID())).statusCode).toBe(404);
    expect((await hints(draft.id, 'fr')).statusCode).toBe(400);
    expect(api.aiGateway.hintRequests).toEqual([]);
  });
});

function rate(conversationId: string, messageId: string, body: unknown, caller = achieng) {
  return api.request(
    'PUT',
    `/v1/me/assistant/conversations/${conversationId}/messages/${messageId}/feedback`,
    caller,
    { body },
  );
}

async function answered(question = VEHICLE_QUESTION) {
  const draft = await givenDraft();
  const conversation = await opened(draft.id);
  const { question: asked, answer } = finalOf((await ask(conversation.id, question)).body);
  return { draft, conversation, question: asked, answer };
}

describe('feedback (S8)', () => {
  it("records the rating and forwards it with the reason, never the note, to the answer's job", async () => {
    const { draft, conversation, answer } = await answered();

    const response = await rate(conversation.id, answer.id, {
      rating: 'not-helpful',
      reason: 'missed-something',
      note: 'It did not say how to value my share',
    });

    expect(response.statusCode, response.body).toBe(200);
    const rated = response.json<AssistantMessage>();
    expect(contractErrors(FEEDBACK_BODY, rated)).toEqual([]);
    expect(rated).toMatchObject({ id: answer.id, rating: 'not-helpful', text: answer.text });
    expect(api.aiGateway.feedback).toEqual([
      {
        tenant: 'psc',
        jobId: expect.any(String) as string,
        feedback: {
          reviewerSubject: ACHIENG,
          block: null,
          rating: 'not-helpful',
          reason: 'missed-something',
          note: null,
        },
      },
    ]);
    const resumed = await opened(draft.id);
    expect(resumed.messages.find((message) => message.id === answer.id)?.rating).toBe(
      'not-helpful',
    );

    const [row] = await api.asPerson(ACHIENG, (tx) =>
      tx.select().from(assistantMessages).where(eq(assistantMessages.id, answer.id)),
    );
    expect(row?.feedbackCiphertext?.toString('utf8')).not.toContain('value my share');
    expect(row?.feedbackCiphertext?.toString('utf8')).not.toContain('missed-something');
    expect(api.cipher.calls).toContainEqual({
      operation: 'encrypt',
      tenant: 'psc',
      recordId: `assistant-message/${answer.id}/feedback`,
    });

    const [event] = await eventsOf('assistant.feedback.recorded.v1');
    expect(event).toMatchObject({
      subject: conversation.id,
      tenant: 'psc',
      data: {
        conversationId: conversation.id,
        messageId: answer.id,
        tenant: 'psc',
        rating: 'not-helpful',
        forwarded: true,
      },
    });
    expect(JSON.stringify(event)).not.toContain('value my share');
  });

  it('replaces an earlier rating', async () => {
    const { conversation, answer } = await answered();
    await rate(conversation.id, answer.id, { rating: 'not-helpful', reason: 'unclear' });

    const again = await rate(conversation.id, answer.id, { rating: 'helpful', reason: null });

    expect(again.json<AssistantMessage>().rating).toBe('helpful');
    expect(api.aiGateway.feedback.map((each) => each.feedback.rating)).toEqual([
      'not-helpful',
      'helpful',
    ]);
  });

  it('keeps the gateway and the answer on the same rating when two land at once', async () => {
    const { draft, conversation, answer } = await answered();
    const release = api.aiGateway.holdFeedback();
    const first = rate(conversation.id, answer.id, { rating: 'not-helpful', reason: 'unclear' });
    await expect.poll(() => api.aiGateway.feedback.length).toBe(1);

    // The second waits for the first, so it cannot reach the gateway first and be overwritten.
    const second = rate(conversation.id, answer.id, { rating: 'helpful', reason: null });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(api.aiGateway.feedback).toHaveLength(1);
    release();
    const responses = await Promise.all([first, second]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    const ratings = api.aiGateway.feedback.map((each) => each.feedback.rating);
    expect(ratings).toEqual(['not-helpful', 'helpful']);
    const resumed = await opened(draft.id);
    expect(resumed.messages.find((message) => message.id === answer.id)?.rating).toBe('helpful');
  });

  it('keeps a rating the gateway cannot take because it does not know the job', async () => {
    const { draft, conversation, answer } = await answered();
    api.aiGateway.forgetJobs();

    const response = await rate(conversation.id, answer.id, { rating: 'helpful', reason: null });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<AssistantMessage>().rating).toBe('helpful');
    expect(api.aiGateway.feedback).toEqual([]);
    const resumed = await opened(draft.id);
    expect(resumed.messages.find((message) => message.id === answer.id)?.rating).toBe('helpful');
    const [event] = await eventsOf('assistant.feedback.recorded.v1');
    expect(event).toMatchObject({
      data: { jobId: expect.any(String) as string, forwarded: false },
    });
  });

  it('keeps the rating of a decline made without the AI, with no job to forward it to', async () => {
    const { conversation, answer } = await answered(OFF_CORPUS_QUESTION);
    expect(answer.declined).toBe(true);

    const response = await rate(conversation.id, answer.id, { rating: 'helpful', reason: null });

    expect(response.statusCode).toBe(200);
    expect(response.json<AssistantMessage>().rating).toBe('helpful');
    expect(api.aiGateway.feedback).toEqual([]);
    const [event] = await eventsOf('assistant.feedback.recorded.v1');
    expect(event).toMatchObject({ data: { jobId: null, forwarded: false } });
  });

  it('answers 503 and keeps nothing when the gateway cannot take the rating', async () => {
    const { draft, conversation, answer } = await answered();
    api.aiGateway.feedbackUnavailable();

    const response = await rate(conversation.id, answer.id, { rating: 'helpful', reason: null });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'assistant-unavailable' });
    const resumed = await opened(draft.id);
    expect(resumed.messages.find((message) => message.id === answer.id)?.rating).toBeNull();
  });

  it("answers 404 for a question, an unknown message and another person's answer", async () => {
    const { conversation, question, answer } = await answered();
    const body = { rating: 'helpful', reason: null };

    expect((await rate(conversation.id, question.id, body)).statusCode).toBe(404);
    expect((await rate(conversation.id, randomUUID(), body)).statusCode).toBe(404);
    expect(
      (await rate(conversation.id, answer.id, body, declarantCaller(randomUUID()))).statusCode,
    ).toBe(404);
    expect((await rate(conversation.id, answer.id, body, admin)).statusCode).toBe(404);
    expect(api.aiGateway.feedback).toEqual([]);
  });

  it('refuses a rating outside the contract', async () => {
    const { conversation, answer } = await answered();

    for (const body of [
      {},
      { rating: 'great', reason: null },
      { rating: 'helpful', reason: 'boring' },
      { rating: 'helpful', reason: null, note: 'x'.repeat(501) },
    ]) {
      expect((await rate(conversation.id, answer.id, body)).statusCode).toBe(400);
    }
  });
});

function themes(slug = 'psc', caller = admin, month?: string) {
  return api.get(
    `/v1/commissions/${slug}/help/themes${month === undefined ? '' : `?month=${month}`}`,
    caller,
  );
}

interface ThemeCount {
  month: string;
  theme: string;
  count: number;
  unanswered: number;
}

describe('question themes (S8)', () => {
  it('counts questions per Commission, month and theme, and the unanswered ones, without any text', async () => {
    api.clock.setToday('2027-11-15');
    const { conversation } = await answered(VEHICLE_QUESTION);
    await ask(conversation.id, SALARY_QUESTION);
    await ask(conversation.id, 'Tell me about my salary allowances');
    api.aiGateway.answer(() => ({
      kind: 'answer',
      output: { label: answerLabel(), declined: true, blocks: [], followUps: [] },
    }));
    await ask(conversation.id, OFF_CORPUS_QUESTION);

    const response = await themes();

    expect(response.statusCode).toBe(200);
    const counts = response.json<ThemeCount[]>();
    expect(contractErrors(THEMES_BODY, counts)).toEqual([]);
    expect(counts).toEqual([
      { month: '2027-11', theme: 'income', count: 2, unanswered: 0 },
      { month: '2027-11', theme: 'joint-ownership', count: 1, unanswered: 0 },
      { month: '2027-11', theme: 'other', count: 1, unanswered: 1 },
    ]);
    expect(response.body).not.toContain('France');
    expect((await themes('psc', officer)).json()).toEqual(counts);
  });

  it('counts a declined answer as unanswered in its theme', async () => {
    api.clock.setToday('2027-11-15');
    const { conversation } = await answered(SALARY_QUESTION);
    api.aiGateway.answer(() => ({
      kind: 'answer',
      output: { label: answerLabel(), declined: true, blocks: [], followUps: [] },
    }));

    await ask(conversation.id, SALARY_QUESTION);

    expect((await themes()).json()).toEqual([
      { month: '2027-11', theme: 'income', count: 2, unanswered: 1 },
    ]);
  });

  it('counts nothing for a question whose answer could not be had', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);
    api.aiGateway.answer(() => ({ kind: 'error', reason: 'provider' }));

    await ask(conversation.id, SALARY_QUESTION);

    expect((await themes()).json()).toEqual([]);
  });

  it('still stores the answer when the question cannot be counted at the Commission', async () => {
    await givenObligation();
    const conversation = await opened(null);
    // The obligation goes (the count's row-level security needs one), the conversation stays.
    await api.asPlatform((tx) => tx.delete(filingObligations));

    const response = await ask(conversation.id, SALARY_QUESTION, null);

    expect(finalOf(response.body).answer.declined).toBe(false);
    expect((await opened(null)).messages).toHaveLength(2);
    expect((await themes()).json()).toEqual([]);
  });

  it('keeps the counts after the draft and its conversation are gone', async () => {
    api.clock.setToday('2027-11-15');
    const { draft } = await answered(SALARY_QUESTION);

    expect((await api.request('DELETE', `/v1/declarations/${draft.id}`, achieng)).statusCode).toBe(
      204,
    );

    expect((await themes()).json()).toEqual([
      { month: '2027-11', theme: 'income', count: 1, unanswered: 0 },
    ]);
  });

  it('reads one month when asked, newest first otherwise', async () => {
    api.clock.setToday('2027-10-20');
    const { conversation } = await answered(SALARY_QUESTION);
    api.clock.setToday('2027-11-15');
    await ask(conversation.id, 'Nitaandika gari langu wapi?');

    expect((await themes('psc', admin, '2027-10')).json()).toEqual([
      { month: '2027-10', theme: 'income', count: 1, unanswered: 0 },
    ]);
    expect((await themes()).json<ThemeCount[]>().map((row) => row.month)).toEqual([
      '2027-11',
      '2027-10',
    ]);
    expect((await themes('psc', admin, '2027-1')).statusCode).toBe(400);
  });

  it("shows a Commission's counts to its own administrators and reporting officers only", async () => {
    await answered(SALARY_QUESTION);

    expect((await themes('tsc', admin)).statusCode).toBe(404);
    expect((await themes('psc', { tenant: 'tsc', roles: ['commission-admin'] })).statusCode).toBe(
      404,
    );
    expect((await themes('psc', achieng)).statusCode).toBe(404);
    expect((await themes('psc', { tenant: 'psc', roles: ['reviewer'] })).statusCode).toBe(404);
    expect((await themes('psc', { tenant: 'tsc', roles: ['reporting-officer'] })).statusCode).toBe(
      404,
    );
    expect(
      (await themes('psc', { tenant: 'platform', roles: ['platform-admin'] })).statusCode,
    ).toBe(404);
  });

  it('lets only a person transaction count, never a staff one', async () => {
    api.clock.setToday('2027-11-15');
    await answered(SALARY_QUESTION);
    const row = {
      tenant: 'psc',
      month: '2027-11',
      theme: 'land' as const,
      count: 1,
      unanswered: 0,
    };

    // The Commission's own staff see its obligations, yet may not count through them.
    await expect(
      api.asTenant('psc', (tx) => tx.insert(assistantThemeCounts).values(row)),
    ).rejects.toThrow();
    const bumped = await api.asTenant('psc', (tx) =>
      tx
        .update(assistantThemeCounts)
        .set({ count: 99 })
        .where(eq(assistantThemeCounts.tenant, 'psc'))
        .returning(),
    );
    expect(bumped).toEqual([]);
    // Another Commission's staff do not read them.
    expect(await api.asTenant('tsc', (tx) => tx.select().from(assistantThemeCounts))).toEqual([]);
    expect((await themes()).json()).toEqual([
      { month: '2027-11', theme: 'income', count: 1, unanswered: 0 },
    ]);
  });
});
