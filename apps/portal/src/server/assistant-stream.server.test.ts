import { beforeEach, describe, expect, it } from 'vitest';

import { readAnswerStream } from '../assistant/stream';
import { bearer, declarationsClient, PERSON } from '../test/declarant';
import { openConversation } from './assistant.server';
import { relayAnswer } from './assistant-stream.server';
import { resetDeclarationsMock, setAnswerPace, setAssistantMode } from './declarations/mock.server';

const APP = 'http://portal.test';
const client = () => declarationsClient(bearer(PERSON));

async function conversationId() {
  const opened = await openConversation(client(), { declarationId: null, language: 'en' });
  if (opened.status !== 'ok') throw new Error(opened.status);
  return opened.conversation.id;
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${APP}/api/assistant/conversations/x/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP, ...headers },
    body: JSON.stringify(body),
  });
}

const question = { text: 'How do I value my car?', sectionKey: null, itemType: null };

beforeEach(() => {
  resetDeclarationsMock();
  setAnswerPace(0);
});

describe('relaying an answer to the browser', () => {
  it('relays the service stream as server-sent events', async () => {
    const id = await conversationId();
    const response = await relayAnswer(post(question), id, client(), APP);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    if (!response.body) throw new Error('no body');
    const events = [];
    for await (const frame of readAnswerStream(response.body)) events.push(frame.event);
    expect(events.at(-1)).toBe('final');
  });

  it('answers 401 when the session has ended', async () => {
    const response = await relayAnswer(post(question), await conversationId(), null, APP);
    expect(response.status).toBe(401);
  });

  it('refuses a cross-origin request and a body that is not a question', async () => {
    const id = await conversationId();
    expect(
      (await relayAnswer(post(question, { origin: 'https://evil.test' }), id, client(), APP))
        .status,
    ).toBe(403);
    expect((await relayAnswer(post({ text: '' }), id, client(), APP)).status).toBe(400);
  });

  it('refuses a request without an Origin, and a body past 16 KB', async () => {
    const id = await conversationId();
    const noOrigin = post(question);
    noOrigin.headers.delete('origin');
    expect((await relayAnswer(noOrigin, id, client(), APP)).status).toBe(403);
    const huge = post({ ...question, text: 'x'.repeat(20_000) });
    expect((await relayAnswer(huge, id, client(), APP)).status).toBe(413);
  });

  it('passes on 429 with when to ask again, and 503 when answers are unavailable', async () => {
    const id = await conversationId();
    setAssistantMode('rate-limited');
    const limited = await relayAnswer(post(question), id, client(), APP);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ status: 'rate-limited', retryAfterSeconds: 60 });

    setAssistantMode('unavailable');
    const down = await relayAnswer(post(question), id, client(), APP);
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ status: 'unavailable' });
  });
});
