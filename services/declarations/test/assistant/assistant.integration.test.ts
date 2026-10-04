import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssistantConversation } from '../../src/assistant/representation.js';
import {
  assistantConversations,
  assistantMessages,
  commissionRefs,
  filingObligations,
} from '../../src/db/schema.js';
import { ConversationExpiry } from '../../src/assistant/expiry.js';
import { ASSISTANT_RATE_LIMIT } from '../../src/config.js';
import { assistantFixtures, declarantCaller, finalOf, framesOf } from '../support/assistant.js';
import { contractErrors, responseBody } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { answerLabel, citingFirstPassage } from '../support/fake-ai-gateway.js';
import { DUE_DAY, submissionFixtures } from '../support/submission.js';
import { SPOUSE_ID } from '../fixtures/sections.js';

/**
 * Spec 11 Ask Adili over HTTP (#333): a declarant's conversation with the assistant, kept with the
 * draft, and answers streamed from the ai-gateway (faked) as server-sent events, checked against
 * the passages retrieved from the real corpus before they are stored. S1 context, S2 streaming
 * and storage, S3 decline, S4 Swahili, S7 deletion and expiry, S10 authorisation.
 */

const ACHIENG = randomUUID();
const OTIENO = randomUUID();
const declarant = declarantCaller;
const achieng = declarant(ACHIENG);

const CONVERSATION_BODY = responseBody('/v1/me/assistant/conversations', 'post', 200);

let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  await api.asPlatform(async (tx) => {
    await tx
      .insert(commissionRefs)
      .values({ slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' });
  });
  api.directory.givenStaff('psc', 'reporting-officer', [
    { subject: randomUUID(), name: 'Mary Wanjiku', email: 'mary.wanjiku@psc.go.ke' },
  ]);
});

const { givenObligation, givenDraft, open, opened, ask, eventsOf } = assistantFixtures(
  () => api,
  ACHIENG,
);

const VEHICLE_QUESTION = 'Do I declare a matatu I co-own with my brother?';
const SALARY_QUESTION = "Do I declare my wife's salary?";

describe('opening a conversation', () => {
  it('opens one conversation per draft and resumes it, kept for as long as the draft', async () => {
    const draft = await givenDraft();

    const first = await open(draft.id);
    const again = await open(draft.id);

    expect(first.statusCode).toBe(200);
    const conversation = first.json<AssistantConversation>();
    expect(contractErrors(CONVERSATION_BODY, conversation)).toEqual([]);
    expect(conversation).toMatchObject({
      declarationId: draft.id,
      language: 'en',
      messages: [],
      expiresAt: null,
    });
    expect(again.json<AssistantConversation>().id).toBe(conversation.id);
  });

  it('switches the language of a resumed conversation', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);

    const switched = await opened(draft.id, 'sw');

    expect(switched).toMatchObject({ id: conversation.id, language: 'sw' });
  });
});

describe('asking a question (S1, S2)', () => {
  it('sends the gateway the context without amounts, names or identifiers, and the passages retrieved', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);

    const response = await ask(conversation.id, SALARY_QUESTION, 'statement:officer', achieng, {
      itemType: 'salary-emoluments',
    });

    expect(response.statusCode).toBe(200);
    const [input] = api.aiGateway.inputs();
    expect(input).toMatchObject({
      kind: 'answer-declarant-question',
      mode: 'answer',
      language: 'en',
      question: SALARY_QUESTION,
      history: [],
      context: {
        declarationType: 'biennial',
        statementDate: '2027-11-01',
        householdCounts: { spouses: 1, children: 1 },
        sectionKey: 'statement:officer',
      },
    });
    expect(input?.context.residuals).toContainEqual({
      sectionKey: 'statement:officer',
      ruleId: 'required',
      fieldPath: '/assets/0/value',
    });
    // The spouse's statement has not been saved: the whole section is still to do.
    expect(input?.context.residuals).toContainEqual({
      sectionKey: `statement:spouse:${SPOUSE_ID}`,
      ruleId: 'section-not-started',
      fieldPath: '',
    });
    const sent = JSON.stringify(input);
    for (const secret of [
      'Toyota Prado',
      'Salary',
      '480000000',
      'Otieno',
      'Grace',
      'Faith',
      'Kisumu',
      'Lavington',
      'Achieng',
      'Mary Wanjiku',
      ACHIENG,
    ]) {
      expect(sent).not.toContain(secret);
    }
    const citations = input?.passages.map((passage) => passage.citation) ?? [];
    expect(citations).toContain('Act s.31');
    expect(citations).toContain('Act First Schedule, para. 8');
    expect(input?.passages.length).toBeLessThanOrEqual(8);
    expect(api.aiGateway.requests[0]?.request).toMatchObject({
      tenant: 'psc',
      subjectRef: `assistant-conversation:${conversation.id}`,
    });
  });

  it('streams the answer, then stores it with its citations and section link and records an event', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);
    api.aiGateway.answer((input) => {
      const s31 = input.passages.find((passage) => passage.citation === 'Act s.31');
      if (!s31) throw new Error('Act s.31 not retrieved');
      return {
        kind: 'answer',
        deltas: ["Yes. Your spouse's income ", 'is declared in her own statement.'],
        output: {
          label: answerLabel(),
          declined: false,
          blocks: [
            {
              text: "Yes. Your spouse's income is declared in her own statement.",
              passageIds: [s31.id],
              sectionLink: { sectionKey: `statement:spouse:${SPOUSE_ID}`, fieldPath: '/income' },
            },
          ],
          followUps: ['How do I value it?'],
        },
      };
    });

    const response = await ask(conversation.id, SALARY_QUESTION);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    const frames = framesOf(response.body);
    expect(frames.slice(0, 2)).toEqual([
      { event: 'delta', data: { text: "Yes. Your spouse's income " } },
      { event: 'delta', data: { text: 'is declared in her own statement.' } },
    ]);
    expect(frames.at(-1)?.event).toBe('final');
    const { question, answer } = finalOf(response.body);
    expect(question).toMatchObject({ role: 'user', text: SALARY_QUESTION, declined: false });
    expect(answer).toMatchObject({
      role: 'assistant',
      text: "Yes. Your spouse's income is declared in her own statement.",
      declined: false,
      sectionLink: { sectionKey: `statement:spouse:${SPOUSE_ID}`, fieldPath: '/income' },
      reportingOfficer: null,
      label: { aiAssisted: true, task: 'answer-declarant-question' },
      rating: null,
    });
    expect(answer.citations.map((citation) => citation.citation)).toEqual(['Act s.31']);

    const resumed = await opened(draft.id);
    expect(contractErrors(CONVERSATION_BODY, resumed)).toEqual([]);
    expect(resumed.messages).toEqual([question, answer]);

    const [event] = await eventsOf('assistant.message.answered.v1');
    expect(event).toMatchObject({
      subject: conversation.id,
      tenant: 'psc',
      data: {
        conversationId: conversation.id,
        tenant: 'psc',
        sectionKey: 'statement:officer',
        declined: false,
        jobId: expect.any(String) as string,
      },
    });
    expect(JSON.stringify(event)).not.toContain('salary');
  });

  it("stores each message encrypted with the conversation's Commission key, bound to the message", async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);

    const { question, answer } = finalOf((await ask(conversation.id, VEHICLE_QUESTION)).body);

    const rows = await api.asPerson(ACHIENG, (tx) =>
      tx.select().from(assistantMessages).orderBy(assistantMessages.id),
    );
    expect(rows.map((row) => row.id)).toEqual([question.id, answer.id]);
    for (const row of rows) expect(row.ciphertext.toString('utf8')).not.toContain('matatu');
    const sealed = api.cipher.calls.filter(
      (call) => call.operation === 'encrypt' && call.recordId.startsWith('assistant-message/'),
    );
    expect(sealed).toEqual([
      { operation: 'encrypt', tenant: 'psc', recordId: `assistant-message/${question.id}` },
      { operation: 'encrypt', tenant: 'psc', recordId: `assistant-message/${answer.id}` },
    ]);
    // The ciphertext opens only as its own message: moved to another, it does not decrypt.
    const [first] = rows;
    if (!first) throw new Error('no message');
    await expect(
      api.cipher.decrypt({
        tenant: 'psc',
        recordId: `assistant-message/${answer.id}`,
        ciphertext: first.ciphertext.toString('base64'),
        envelope: first.envelope,
      }),
    ).rejects.toThrow();
    await expect(
      api.cipher.decrypt({
        tenant: 'tsc',
        recordId: `assistant-message/${question.id}`,
        ciphertext: first.ciphertext.toString('base64'),
        envelope: first.envelope,
      }),
    ).rejects.toThrow();
  });

  it('sends earlier turns as history, without the reporting officer contact of a decline', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);
    await ask(conversation.id, VEHICLE_QUESTION);
    api.aiGateway.answer(() => ({
      kind: 'answer',
      output: { label: answerLabel(), declined: true, blocks: [], followUps: [] },
    }));
    await ask(conversation.id, SALARY_QUESTION);

    // A follow-up that retrieves nothing alone is read with the question before it.
    await ask(conversation.id, 'And what about the loan on it?');

    const history = api.aiGateway.inputs()[2]?.history ?? [];
    expect(history.map((turn) => turn.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(history[0]?.text).toBe(VEHICLE_QUESTION);
    expect(JSON.stringify(history)).not.toContain('Mary Wanjiku');
    expect(JSON.stringify(history)).not.toContain('psc.go.ke');
  });
});

describe('grounded or silent (S3)', () => {
  it('replaces an answer citing a passage that was not retrieved with the decline and the reporting officer', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);
    api.aiGateway.answer((input) => ({
      kind: 'answer',
      deltas: ['Yes, but only if he agrees.'],
      output: {
        label: answerLabel(),
        declined: false,
        blocks: [
          {
            text: 'Yes, declare it.',
            passageIds: [input.passages[0]?.id ?? ''],
            sectionLink: null,
          },
          { text: 'But only if he agrees.', passageIds: ['made-up-passage'], sectionLink: null },
        ],
        followUps: [],
      },
    }));

    const response = await ask(conversation.id, SALARY_QUESTION);

    const { answer } = finalOf(response.body);
    expect(answer).toMatchObject({
      role: 'assistant',
      declined: true,
      text: 'I could not find this in the Act or Regulations. Ask your reporting officer.',
      citations: [],
      sectionLink: null,
      reportingOfficer: { name: 'Mary Wanjiku', email: 'mary.wanjiku@psc.go.ke', phone: null },
    });
    const [event] = await eventsOf('assistant.message.answered.v1');
    expect(event).toMatchObject({ data: { declined: true } });
    expect(JSON.stringify(event)).not.toContain('Mary');
    expect((await opened(draft.id)).messages[1]).toEqual(answer);
  });

  it('declines an answer whose blocks cite nothing, and one the gateway declined', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);
    api.aiGateway.answer(() => ({
      kind: 'answer',
      output: {
        label: answerLabel(),
        declined: false,
        blocks: [{ text: 'Yes.', passageIds: [], sectionLink: null }],
        followUps: [],
      },
    }));
    const uncited = finalOf((await ask(conversation.id, SALARY_QUESTION)).body);
    api.aiGateway.answer(() => ({
      kind: 'answer',
      output: { label: answerLabel(), declined: true, blocks: [], followUps: [] },
    }));
    const declined = finalOf((await ask(conversation.id, SALARY_QUESTION)).body);

    expect(uncited.answer.declined).toBe(true);
    expect(declined.answer).toMatchObject({ declined: true, label: { aiAssisted: true } });
  });

  it('declines without asking the gateway when nothing in the corpus matches', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);

    const response = await ask(conversation.id, 'What is the capital of France?');

    expect(response.statusCode).toBe(200);
    expect(api.aiGateway.requests).toEqual([]);
    expect(framesOf(response.body).map((frame) => frame.event)).toEqual(['final']);
    expect(finalOf(response.body).answer).toMatchObject({
      declined: true,
      label: null,
      reportingOfficer: { name: 'Mary Wanjiku' },
    });
    const [event] = await eventsOf('assistant.message.answered.v1');
    expect(event).toMatchObject({ data: { declined: true, jobId: null } });
  });

  it('still declines when the reporting officer cannot be read, without a contact', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);
    api.directory.failStaffReads();

    const response = await ask(conversation.id, 'What is the capital of France?');

    expect(finalOf(response.body).answer).toMatchObject({ declined: true, reportingOfficer: null });
  });

  it('leaves out a section link that names no section of the draft', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);
    api.aiGateway.answer((input) => ({
      kind: 'answer',
      output: {
        label: answerLabel(),
        declined: false,
        blocks: [
          {
            text: 'Declare it in the statement of the child concerned.',
            passageIds: [input.passages[0]?.id ?? ''],
            sectionLink: { sectionKey: `statement:child:${randomUUID()}`, fieldPath: '/income' },
          },
        ],
        followUps: [],
      },
    }));

    const { answer } = finalOf((await ask(conversation.id, SALARY_QUESTION)).body);

    expect(answer).toMatchObject({ declined: false, sectionLink: null });
  });
});

describe('Kiswahili (S4)', () => {
  it('asks and answers in Swahili with the same citations as in English', async () => {
    const draft = await givenDraft();
    const english = await opened(draft.id, 'en');
    await ask(
      english.id,
      'Do I declare a vehicle I co-own with my brother?',
      'statement:officer',
      achieng,
      {
        itemType: 'vehicle',
      },
    );
    const conversation = await opened(draft.id, 'sw');
    const question = 'Nitatangaza gari ninalomiliki pamoja na kaka yangu?';

    const response = await ask(conversation.id, question, 'statement:officer', achieng, {
      itemType: 'vehicle',
    });

    const [inEnglish, input] = api.aiGateway.inputs();
    expect(input).toMatchObject({ language: 'sw', question });
    const citationsOf = (each: typeof input) =>
      new Set(each?.passages.map((passage) => passage.citation));
    expect(citationsOf(input)).toEqual(citationsOf(inEnglish));
    expect(input?.passages.map((passage) => passage.citation)).toContain(
      'Act First Schedule, para. 8',
    );
    const { answer } = finalOf(response.body);
    expect(answer.text).toMatch(/^Ndiyo, tangaza gari/);
    expect(answer.citations.map((citation) => citation.citation)).toEqual([
      input?.passages[0]?.citation,
    ]);
  });

  it('declines in Swahili', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id, 'sw');

    const response = await ask(conversation.id, 'Mji mkuu wa Ufaransa ni upi?');

    expect(finalOf(response.body).answer).toMatchObject({
      declined: true,
      text: 'Sikupata jambo hili katika Sheria wala Kanuni. Muulize afisa wako wa kuripoti.',
    });
  });

  it('sends an earlier decline as history in the language it was given in', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);
    api.aiGateway.answer(() => ({
      kind: 'answer',
      output: { label: answerLabel(), declined: true, blocks: [], followUps: [] },
    }));
    const declined = finalOf((await ask(conversation.id, SALARY_QUESTION)).body).answer;
    api.aiGateway.reset();
    await opened(draft.id, 'sw');

    await ask(
      conversation.id,
      'Nitatangaza gari ninalomiliki pamoja na kaka yangu?',
      'statement:officer',
      achieng,
      { itemType: 'vehicle' },
    );

    expect(api.aiGateway.inputs()[0]?.history[1]).toEqual({
      role: 'assistant',
      text: declined.text,
    });
  });
});

describe('when the assistant is unavailable', () => {
  it('answers 503 and stores nothing when the gateway does not take the question', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);
    api.aiGateway.answer(() => ({ kind: 'unavailable' }));

    const response = await ask(conversation.id, SALARY_QUESTION);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'assistant-unavailable', status: 503 });
    expect((await opened(draft.id)).messages).toEqual([]);
  });

  it('ends the stream with an error and stores nothing when the job fails midway', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);
    api.aiGateway.answer(() => ({ kind: 'error', reason: 'provider', deltas: ['Yes, '] }));

    const response = await ask(conversation.id, SALARY_QUESTION);

    expect(response.statusCode).toBe(200);
    expect(framesOf(response.body)).toEqual([
      { event: 'delta', data: { text: 'Yes, ' } },
      { event: 'error', data: { code: 'assistant-unavailable' } },
    ]);
    expect((await opened(draft.id)).messages).toEqual([]);
    expect(await eventsOf('assistant.message.answered.v1')).toEqual([]);
  });

  it('cancels the job and stores nothing when the declarant leaves midway', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);
    // The gateway's final arrives after the declarant has gone, as one already on its way would.
    api.aiGateway.answer((input) => ({
      kind: 'held',
      output: citingFirstPassage(input),
      deltas: ['Yes, '],
    }));
    const leave = new AbortController();
    const response = await fetch(
      `${await api.listen()}/v1/me/assistant/conversations/${conversation.id}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await api.token(achieng)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: SALARY_QUESTION, sectionKey: 'statement:officer' }),
        signal: leave.signal,
      },
    );
    expect(response.status).toBe(200);
    const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();
    if (!reader) throw new Error('No response body');
    const decoder = new TextDecoder();
    let received = '';
    while (!received.includes('event: delta')) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`The stream ended before a delta: ${received}`);
      received += decoder.decode(chunk.value, { stream: true });
    }

    leave.abort();

    // Once the service has let go of the gateway's stream, whatever it would store is stored.
    await vi.waitUntil(() => api.aiGateway.requests[0]?.closed, { timeout: 10_000 });
    expect(api.aiGateway.requests[0]?.signal.aborted).toBe(true);
    expect(await api.asPerson(ACHIENG, (tx) => tx.select().from(assistantMessages))).toEqual([]);
    expect(await eventsOf('assistant.message.answered.v1')).toEqual([]);
  });

  it('refuses a question that is empty or too long', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);

    for (const text of ['   ', 'x'.repeat(2001)]) {
      expect((await ask(conversation.id, text)).statusCode).toBe(400);
    }
    expect(api.aiGateway.requests).toEqual([]);
  });
});

describe("the declarant's rate limit", () => {
  it('answers 429 past the limit, without asking the gateway or storing the question', async () => {
    api.rateLimits[ASSISTANT_RATE_LIMIT] = { limit: 2, windowSeconds: 60 };
    // A declarant of the test's own, whose budget no other test has drawn on.
    const personId = randomUUID();
    const caller = declarant(personId);
    await givenObligation(personId);
    const conversation = (await open(null, 'en', caller)).json<AssistantConversation>();
    for (const question of [VEHICLE_QUESTION, SALARY_QUESTION]) {
      expect((await ask(conversation.id, question, null, caller)).statusCode).toBe(200);
    }
    const asked = api.aiGateway.requests.length;

    const refused = await ask(conversation.id, VEHICLE_QUESTION, null, caller);

    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ type: 'rate-limit-exceeded', status: 429 });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(refused.headers['ratelimit-remaining']).toBe('0');
    expect(api.aiGateway.requests).toHaveLength(asked);
    const messages = await api.asPerson(personId, (tx) =>
      tx.select().from(assistantMessages).orderBy(assistantMessages.id),
    );
    // The two questions answered, and nothing of the third.
    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });
});

const filing = submissionFixtures(() => api);

/**
 * The conversations stored, whoever's (as the platform, which reads them), and the person's
 * messages: a conversation's messages cannot outlive it (the foreign key cascades).
 */
async function stored(personId = ACHIENG) {
  return {
    conversations: await api.asPlatform((tx) => tx.select().from(assistantConversations)),
    messages: await api.asPerson(personId, (tx) => tx.select().from(assistantMessages)),
  };
}

describe('kept with the draft (S7)', () => {
  it('deletes the conversation when the draft is discarded', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);
    await ask(conversation.id, SALARY_QUESTION);

    const discarded = await api.request('DELETE', `/v1/declarations/${draft.id}`, achieng);

    expect(discarded.statusCode).toBe(204);
    expect(await stored()).toEqual({ conversations: [], messages: [] });
    expect((await ask(conversation.id, SALARY_QUESTION)).statusCode).toBe(404);
    expect((await open(draft.id)).statusCode).toBe(404);
  });

  it('deletes the conversation when the draft is submitted, and when an amendment is discarded', async () => {
    api.clock.setToday(DUE_DAY);
    const personId = randomUUID();
    const caller = filing.declarant(personId);
    const draft = await filing.completeDraft(personId);
    const first = await open(draft.id, 'en', caller);
    await ask(first.json<AssistantConversation>().id, SALARY_QUESTION, null, caller);

    const submitted = await filing.submit(draft.id, filing.steppedUp(personId));

    expect(submitted.statusCode).toBe(201);
    expect((await stored()).conversations).toEqual([]);
    expect((await open(draft.id, 'en', caller)).statusCode).toBe(404);

    const amending = await api.request('POST', `/v1/declarations/${draft.id}/amend`, caller);
    expect(amending.statusCode).toBe(200);
    const again = await open(draft.id, 'en', caller);
    expect(again.statusCode).toBe(200);
    await ask(again.json<AssistantConversation>().id, SALARY_QUESTION, null, caller);

    const discarded = await api.request(
      'POST',
      `/v1/declarations/${draft.id}/amend/discard`,
      caller,
    );

    expect(discarded.statusCode).toBe(200);
    expect(await stored(personId)).toEqual({ conversations: [], messages: [] });
  });

  it('keeps a conversation outside a draft for 30 days after its last message', async () => {
    await givenObligation();
    api.clock.setToday('2027-11-15');
    const conversation = await opened(null);
    expect(conversation).toMatchObject({ declarationId: null });
    expect(conversation.expiresAt).toBe('2027-12-15T09:00:00.000Z');

    api.clock.setToday('2027-12-01');
    const response = await ask(conversation.id, SALARY_QUESTION, 'statement:officer');
    expect(response.statusCode).toBe(200);
    // Outside a draft there is no section or residual to send.
    expect(api.aiGateway.inputs()[0]?.context).toEqual({
      declarationType: null,
      statementDate: null,
      householdCounts: { spouses: 0, children: 0 },
      sectionKey: null,
      residuals: [],
    });
    const resumed = await opened(null);
    expect(resumed).toMatchObject({ id: conversation.id, expiresAt: '2027-12-31T09:00:00.000Z' });

    const sweep = api.app.get(ConversationExpiry);
    api.clock.setToday('2027-12-30');
    expect(await sweep.sweep()).toBe(0);
    api.clock.setToday('2027-12-31');
    expect(await sweep.sweep()).toBe(1);
    expect(await stored()).toEqual({ conversations: [], messages: [] });

    const fresh = await opened(null);
    expect(fresh.id).not.toBe(conversation.id);
    expect(fresh.messages).toEqual([]);
  });

  it("is held at the Commission of the declarant's latest obligation when there are two", async () => {
    await givenObligation(ACHIENG, 'psc');
    const tsc = await givenObligation(ACHIENG, 'tsc');
    await api.asPlatform((tx) =>
      tx
        .update(filingObligations)
        .set({ dueDate: '2028-06-30' })
        .where(eq(filingObligations.id, tsc)),
    );
    api.directory.givenStaff('tsc', 'reporting-officer', [
      { subject: randomUUID(), name: 'Peter Kamau', email: 'peter.kamau@tsc.go.ke' },
    ]);
    const conversation = await opened(null);

    const declined = finalOf((await ask(conversation.id, 'What is the capital of France?')).body);
    const answered = await ask(conversation.id, SALARY_QUESTION);

    expect(answered.statusCode).toBe(200);
    expect(api.aiGateway.requests[0]?.request.tenant).toBe('tsc');
    expect(declined.answer.reportingOfficer).toMatchObject({ name: 'Peter Kamau' });
    expect(api.directory.staffReads).toEqual(['tsc']);
    const sealed = api.cipher.calls.filter((call) =>
      call.recordId.startsWith('assistant-message/'),
    );
    expect(new Set(sealed.map((call) => call.tenant))).toEqual(new Set(['tsc']));
  });

  it('stores nothing when the conversation expires while the answer streams', async () => {
    await givenObligation();
    api.clock.setToday('2027-11-15');
    const conversation = await opened(null);
    api.aiGateway.answer((input) => {
      // The answer ends after the 30 days have run out.
      api.clock.setToday('2027-12-16');
      return { kind: 'answer', output: citingFirstPassage(input) };
    });
    api.clock.setToday('2027-12-15');
    api.clock.advance(-60 * 60 * 1000);

    const response = await ask(conversation.id, SALARY_QUESTION);

    expect(framesOf(response.body).at(-1)).toEqual({
      event: 'error',
      data: { code: 'assistant-unavailable' },
    });
    expect(await eventsOf('assistant.message.answered.v1')).toEqual([]);
    expect(await api.asPerson(ACHIENG, (tx) => tx.select().from(assistantMessages))).toEqual([]);
  });

  it('reads an expired conversation as gone before the sweep deletes it', async () => {
    await givenObligation();
    api.clock.setToday('2027-11-15');
    const conversation = await opened(null);

    api.clock.setToday('2027-12-16');

    expect((await ask(conversation.id, SALARY_QUESTION)).statusCode).toBe(404);
    expect((await opened(null)).id).not.toBe(conversation.id);
  });

  it('never lets the sweep delete a draft conversation', async () => {
    const draft = await givenDraft();
    await opened(draft.id);
    api.clock.setToday('2099-01-01');

    expect(await api.app.get(ConversationExpiry).sweep()).toBe(0);
    expect((await stored()).conversations).toHaveLength(1);
  });
});

describe('authorisation (S10)', () => {
  it("answers 404 for another person's conversation and draft", async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);
    const otieno = declarant(OTIENO);
    await givenObligation(OTIENO);

    expect((await open(draft.id, 'en', otieno)).statusCode).toBe(404);
    expect((await ask(conversation.id, SALARY_QUESTION, null, otieno)).statusCode).toBe(404);
    expect(api.aiGateway.requests).toEqual([]);
    const theirs = await open(null, 'en', otieno);
    expect(theirs.statusCode).toBe(200);
    expect(theirs.json<AssistantConversation>().id).not.toBe(conversation.id);
  });

  it('answers 404 to staff and to a declarant without a filing obligation', async () => {
    const draft = await givenDraft();
    const conversation = await opened(draft.id);
    const staff: Caller = { tenant: 'psc', roles: ['reporting-officer', 'commission-admin'] };

    expect((await open(draft.id, 'en', staff)).statusCode).toBe(404);
    expect((await ask(conversation.id, SALARY_QUESTION, null, staff)).statusCode).toBe(404);
    expect((await open(null, 'en', declarant(randomUUID()))).statusCode).toBe(404);
    expect((await ask('not-a-uuid', SALARY_QUESTION)).statusCode).toBe(404);
  });

  it('answers 401 without a token', async () => {
    const response = await api.app.inject({
      method: 'POST',
      url: '/v1/me/assistant/conversations',
      payload: { declarationId: null, language: 'en' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("the Commission's own articles (S6, S9)", () => {
  it("cites the platform's and the draft's Commission's articles, never another Commission's", async () => {
    const draft = await givenDraft();
    // Achieng also has an obligation with the TSC, whose articles her help search may read.
    await givenObligation(ACHIENG, 'tsc');
    for (const slug of ['psc', 'tsc']) {
      const created = await api.request(
        'POST',
        `/v1/commissions/${slug}/help/articles`,
        { tenant: slug, roles: ['commission-admin'] },
        {
          headers: { 'idempotency-key': randomUUID() },
          body: {
            title: `${slug.toUpperCase()} guidance on a spouse's salary`,
            bodyEn: "Declare your wife's salary in her own statement, as our HR office advises.",
            bodySw: null,
            tags: ['income', 'spouse'],
            effectiveFrom: '2026-01-01',
            effectiveTo: null,
            published: true,
          },
        },
      );
      expect(created.statusCode).toBe(201);
    }
    const conversation = await opened(draft.id);

    await ask(conversation.id, SALARY_QUESTION);

    const citations = api.aiGateway.inputs()[0]?.passages.map((passage) => passage.citation);
    expect(citations).toContain("Help: PSC guidance on a spouse's salary");
    expect(citations).not.toContain("Help: TSC guidance on a spouse's salary");
  });
});
