import { beforeEach, describe, expect, it } from 'vitest';

import { type AnswerFrame, readAnswerStream } from '../assistant/stream';
import { bearer, declarationsClient, PERSON } from '../test/declarant';
import {
  askAssistant,
  type AskResult,
  openConversation,
  rateAnswer,
  searchHelp,
} from './assistant.server';
import { resetDeclarationsMock, setAnswerPace, setAssistantMode } from './declarations/mock.server';

const DRAFT = '0b1e5a1d-5c0a-4d3e-9f10-00000000d001';
const declarant = () => declarationsClient(bearer(PERSON));

async function open(declarationId: string | null = DRAFT, language: 'en' | 'sw' = 'en') {
  const result = await openConversation(declarant(), { declarationId, language });
  if (result.status !== 'ok') throw new Error(result.status);
  return result.conversation;
}

async function frames(result: AskResult): Promise<AnswerFrame[]> {
  if (result.status !== 'streaming') throw new Error(result.status);
  const out: AnswerFrame[] = [];
  for await (const frame of readAnswerStream(result.body)) out.push(frame);
  return out;
}

function ask(
  conversationId: string,
  text: string,
  sectionKey: string | null = 'statement:officer',
) {
  return askAssistant(declarant(), conversationId, { text, sectionKey, itemType: null });
}

beforeEach(() => {
  resetDeclarationsMock();
  setAnswerPace(0);
});

describe('opening a conversation', () => {
  it("opens the draft's conversation, then resumes the same one in another language", async () => {
    const first = await open(DRAFT, 'en');
    expect(first).toMatchObject({ declarationId: DRAFT, language: 'en', messages: [] });
    expect(first.expiresAt).toBeNull();

    const again = await open(DRAFT, 'sw');
    expect(again).toMatchObject({ id: first.id, language: 'sw' });
  });

  it('opens one outside a draft, which expires', async () => {
    const outside = await open(null);
    expect(outside.declarationId).toBeNull();
    expect(outside.expiresAt).not.toBeNull();
  });
});

describe('asking (S2, S3, S4)', () => {
  it('streams a grounded answer with citations and a section link, and keeps both turns', async () => {
    const conversation = await open();
    const result = await frames(
      await ask(conversation.id, 'Is a matatu I co-own with my brother an asset?'),
    );

    const deltas = result.filter((frame) => frame.event === 'delta');
    expect(deltas.length).toBeGreaterThan(1);
    const final = result.at(-1);
    if (final?.event !== 'final') throw new Error('no final frame');
    expect(final.question).toMatchObject({
      role: 'user',
      text: 'Is a matatu I co-own with my brother an asset?',
    });
    expect(final.answer).toMatchObject({
      role: 'assistant',
      declined: false,
      sectionLink: { sectionKey: 'statement:officer', fieldPath: '/assets' },
      label: { aiAssisted: true, task: 'answer-declarant-question' },
    });
    expect(final.answer.text.startsWith('Yes. A vehicle you own with someone else')).toBe(true);
    expect(final.answer.citations.map((citation) => citation.citation)).toEqual([
      'First Schedule, para 8',
      'Help: Joint assets',
    ]);

    const resumed = await open();
    expect(resumed.messages.map((message) => message.id)).toEqual([
      final.question.id,
      final.answer.id,
    ]);
  });

  it("declines what the corpus cannot support, with the reporting officer's contact", async () => {
    const conversation = await open();
    const result = await frames(await ask(conversation.id, 'Can my employer see my declaration?'));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      event: 'final',
      answer: {
        declined: true,
        citations: [],
        sectionLink: null,
        label: null,
        reportingOfficer: { name: 'Joseph Kiplagat', email: 'reporting.officer@tsc.go.ke' },
      },
    });
  });

  it('answers in Swahili with the same citations', async () => {
    const conversation = await open(DRAFT, 'sw');
    const result = await frames(
      await ask(conversation.id, 'Je, matatu ninayomiliki pamoja na kaka yangu ni mali?'),
    );
    const final = result.at(-1);
    if (final?.event !== 'final') throw new Error('no final frame');
    expect(final.answer.text.startsWith('Ndiyo.')).toBe(true);
    expect(final.answer.citations.map((citation) => citation.citation)).toEqual([
      'First Schedule, para 8',
      'Help: Joint assets',
    ]);
    expect(final.answer.citations[0]?.language).toBe('sw');
  });

  it('leaves out the section link outside a draft', async () => {
    const conversation = await open(null);
    const result = await frames(await ask(conversation.id, 'How do I value my car?', null));
    const final = result.at(-1);
    if (final?.event !== 'final') throw new Error('no final frame');
    expect(final.answer.sectionLink).toBeNull();
  });

  it('says the assistant is unavailable, and stores nothing', async () => {
    const conversation = await open();
    setAssistantMode('unavailable');
    expect(await ask(conversation.id, 'How do I value my car?')).toEqual({
      status: 'unavailable',
    });
    expect((await open()).messages).toEqual([]);
  });

  it('ends an answer that fails part-way with an error frame, and stores nothing', async () => {
    const conversation = await open();
    setAssistantMode('fail-midway');
    const result = await frames(await ask(conversation.id, 'How do I value my car?'));
    expect(result.at(-1)).toEqual({ event: 'error', code: 'assistant-unavailable' });
    expect(result.some((frame) => frame.event === 'delta')).toBe(true);
    expect((await open()).messages).toEqual([]);
  });

  it('refuses a declarant who asks too often', async () => {
    const conversation = await open();
    setAssistantMode('rate-limited');
    expect(await ask(conversation.id, 'How do I value my car?')).toEqual({
      status: 'rate-limited',
      retryAfterSeconds: 60,
    });
  });

  it("does not show another person's conversation (S10)", async () => {
    const conversation = await open();
    const someoneElse = declarationsClient(
      bearer({ person_id: '11111111-2222-4333-8444-555555555555' }),
    );
    expect(
      await askAssistant(someoneElse, conversation.id, {
        text: 'How do I value my car?',
        sectionKey: null,
        itemType: null,
      }),
    ).toEqual({ status: 'not-found' });
  });
});

describe('rating an answer', () => {
  it('records the rating on the answer', async () => {
    const conversation = await open();
    const result = await frames(await ask(conversation.id, 'How do I value my car?'));
    const final = result.at(-1);
    if (final?.event !== 'final') throw new Error('no final frame');

    expect(
      await rateAnswer(declarant(), conversation.id, final.answer.id, {
        rating: 'not-helpful',
        reason: 'unclear',
        note: null,
      }),
    ).toEqual({ status: 'rated' });
    expect((await open()).messages[1]?.rating).toBe('not-helpful');
  });
});

describe('help search (no-AI mode)', () => {
  it('finds passages in the language asked, with their citations', async () => {
    const result = await searchHelp(declarant(), {
      q: 'joint',
      language: 'en',
      sectionKey: 'statement:officer',
    });
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.passages.map((passage) => passage.citation)).toContain('Help: Joint assets');

    const swahili = await searchHelp(declarant(), {
      q: 'pamoja',
      language: 'sw',
      sectionKey: null,
    });
    if (swahili.status !== 'ok') throw new Error(swahili.status);
    expect(swahili.passages[0]?.language).toBe('sw');
  });

  it('works while answers are unavailable', async () => {
    setAssistantMode('unavailable');
    const result = await searchHelp(declarant(), { q: 'value', language: 'en', sectionKey: null });
    expect(result.status).toBe('ok');
  });
});
