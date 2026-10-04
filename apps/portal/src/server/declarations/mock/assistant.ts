/**
 * Ask Adili in memory (spec 11, `assistant` and `help/search` in declarations.yaml), behind
 * ASSISTANT_MOCK. Conversations are the caller's own (by the token's `person_id`; anyone else's
 * answers 404): one per draft and one outside a draft, which expires 30 days after its last
 * message. A question streams a canned grounded answer word by word (`delta` frames, then
 * `final` with both turns); any question it has no answer for is declined with the reporting
 * officer's contact, as the service declines an answer the corpus does not support. A draft's
 * section links point at its own sections: the first vehicle's value, a spouse's income.
 *
 * Tests and demos switch how the gateway behaves with `setAssistantMode`: `unavailable` answers
 * 503 `assistant-unavailable` (the panel's help search mode), `fail-midway` stops part-way with an
 * `error` frame, `rate-limited` answers 429. `setAnswerPace(0)` streams at once.
 */
import type { ASSISTANT_MOCK_MODES } from '../../env.server';
import { problem, isRecord, json, readJson } from '../../mock-http';
import type { AssistantConversation, AssistantMessage, HelpPassage } from '../types';
import { CORPUS, type CorpusPassage, passage } from './corpus';
import { store, type Stored } from './store';

export type AssistantMode = (typeof ASSISTANT_MOCK_MODES)[number];

type Language = 'en' | 'sw';
type SectionLink = NonNullable<AssistantMessage['sectionLink']>;

interface Conversation {
  id: string;
  owner: string;
  declarationId: string | null;
  language: Language;
  messages: AssistantMessage[];
  lastMessageAt: number;
}

const conversations = new Map<string, Conversation>();
let mode: AssistantMode = 'ok';
/** Milliseconds between streamed words, and before the first. */
let pace = 35;

const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_SECONDS = 60;

export function setAssistantMode(next: AssistantMode) {
  mode = next;
}

export function setAnswerPace(milliseconds: number) {
  pace = milliseconds;
}

export function resetAssistantMock() {
  conversations.clear();
  mode = 'ok';
}

const DECLINE: Record<Language, string> = {
  en: 'I could not find this in the Act or Regulations. Ask your reporting officer.',
  sw: 'Sikupata jambo hili katika Sheria wala Kanuni. Muulize afisa wako wa kuripoti.',
};

const DISCLAIMER: Record<Language, string> = {
  en: 'AI-assisted. Not legal advice.',
  sw: 'Kwa usaidizi wa AI. Si ushauri wa kisheria.',
};

/** Reporting officers by Commission slug; a Commission without one declines without a contact. */
const REPORTING_OFFICERS: Record<string, AssistantMessage['reportingOfficer']> = {
  tsc: { name: 'Joseph Kiplagat', email: 'reporting.officer@tsc.go.ke', phone: '020 289 2000' },
  psc: { name: 'Grace Wambui', email: 'declarations@publicservice.go.ke', phone: null },
};

interface Canned {
  pattern: RegExp;
  cites: string[];
  en: string;
  sw: string;
  link?: (stored: Stored | undefined) => SectionLink | null;
}

function officerStatement(stored: Stored | undefined) {
  return stored?.contents.get('statement:officer') as { assets?: { type?: string }[] } | undefined;
}

const ANSWERS: Canned[] = [
  {
    pattern: /matatu|co-?own|jointly|pamoja/i,
    cites: ['fs-8', 'help-joint'],
    en: 'Yes. A vehicle you own with someone else is an asset. Declare it under Assets as a vehicle, at its whole value. Then switch on "Jointly held" and enter your share, for example 50%.',
    sw: 'Ndiyo. Gari unalomiliki pamoja na mtu mwingine ni mali. Litaje chini ya Mali kama gari, kwa thamani yake yote. Kisha washa "Inamilikiwa kwa pamoja" na uandike sehemu yako, kwa mfano 50%.',
    link: () => ({ sectionKey: 'statement:officer', fieldPath: '/assets' }),
  },
  {
    pattern: /value|worth|thamin/i,
    cites: ['am-24', 'help-value'],
    en: 'Give an approximate value as at the statement date: roughly what it would sell for then. You do not need a professional valuation.',
    sw: 'Weka thamani ya kukadiria kufikia tarehe ya taarifa: takriban bei ambayo lingeuzwa wakati huo. Huhitaji tathmini ya kitaalamu.',
    link: (stored) => {
      const index =
        officerStatement(stored)?.assets?.findIndex((item) => item.type === 'vehicle') ?? -1;
      return {
        sectionKey: 'statement:officer',
        fieldPath: index >= 0 ? `/assets/${String(index)}/value` : '/assets',
      };
    },
  },
  {
    pattern: /after I submit|amend|badilisha tamko/i,
    cites: ['help-amend'],
    en: 'Yes. After you submit, you can amend your declaration until the due date. Each amendment files a new version, and earlier versions are kept.',
    sw: 'Ndiyo. Baada ya kuwasilisha, unaweza kurekebisha tamko lako hadi tarehe ya mwisho. Kila marekebisho yanawasilisha toleo jipya, na matoleo ya awali yanahifadhiwa.',
  },
  {
    pattern: /material|mabadiliko/i,
    cites: ['act-31-4', 'regs-21'],
    en: 'A material change since your last declaration is any of these: a rise or fall of 25% or more in an income, asset or liability; buying or disposing of an asset, or taking on or settling a liability; a change in marital status; a new or changed directorship; or a change in your memberships.\n\nMark the item "Changed since my last declaration" and explain it.',
    sw: 'Mabadiliko makubwa tangu tamko lako la mwisho ni mojawapo ya haya: ongezeko au upungufu wa asilimia 25 au zaidi katika mapato, mali au deni; kununua au kuuza mali, au kuchukua au kulipa deni; mabadiliko ya hali ya ndoa; ukurugenzi mpya au uliobadilika; au mabadiliko ya uanachama wako.\n\nWeka alama "Imebadilika tangu tamko langu la mwisho" kwenye kipengele na ueleze.',
    link: () => ({ sectionKey: 'other', fieldPath: null }),
  },
  {
    pattern: /wife|husband|spouse|mke|mume|mwenzi/i,
    cites: ['act-31-1', 'help-spouse'],
    en: 'Yes. Your declaration covers your spouse too. Add their salary as income in their own financial statement, as an approximate amount for the income period.',
    sw: 'Ndiyo. Tamko lako linamhusu mwenzi wako pia. Ongeza mshahara wake kama mapato katika taarifa yake ya kifedha, kwa kiasi cha kukadiria kwa kipindi cha mapato.',
    link: (stored) => {
      const spouse = stored?.persons.find(
        (key) => key.startsWith('statement:spouse:') && !stored.archived.has(key),
      );
      return spouse
        ? { sectionKey: spouse, fieldPath: '/income' }
        : { sectionKey: 'household', fieldPath: null };
    },
  },
  {
    pattern: /turned 18|child|mtoto|miaka 18/i,
    cites: ['act-31-1', 'help-children'],
    en: 'Include children who are under 18 on your statement date. A child who turned 18 before that date is not included and needs no statement.',
    sw: 'Jumuisha watoto walio chini ya miaka 18 tarehe ya taarifa yako. Mtoto aliyetimiza miaka 18 kabla ya tarehe hiyo hajumuishwi na hahitaji taarifa.',
    link: () => ({ sectionKey: 'household', fieldPath: null }),
  },
  {
    pattern: /nature of employment|permanent|contract|aina ya ajira/i,
    cites: ['fs-5'],
    en: 'Choose the terms of your appointment: permanent, temporary or contract. If none fits, choose Other and describe it, for example a secondment.',
    sw: 'Chagua masharti ya uteuzi wako: wa kudumu, wa muda au wa mkataba. Ikiwa hakuna kinachofaa, chagua Nyingine na ueleze, kwa mfano uhamisho wa muda.',
    link: () => ({ sectionKey: 'bio', fieldPath: '/employment/nature' }),
  },
  {
    pattern: /loan|debt|mkopo|deni/i,
    cites: ['help-loans', 'fs-8'],
    en: 'Declare what you owed on the statement date: the balance on your loan statement, not the amount you first borrowed. Include SACCO loans, mortgages and hire purchase.',
    sw: 'Tangaza kiasi ulichodaiwa tarehe ya taarifa: salio kwenye taarifa ya mkopo wako, si kiasi ulichokopa mwanzoni. Jumuisha mikopo ya SACCO, rehani na mikopo ya kununua kwa awamu.',
    link: () => ({ sectionKey: 'statement:officer', fieldPath: '/liabilities' }),
  },
  {
    pattern: /who do i declare|kwa ajili ya nani/i,
    cites: ['act-31-1'],
    en: 'You declare for yourself, your spouse or spouses, and your dependent children who are under 18 on the statement date. Each person gets a separate financial statement.',
    sw: 'Unatangaza kwa ajili yako, mwenzi au wenzi wako, na watoto wanaokutegemea walio chini ya miaka 18 tarehe ya taarifa. Kila mtu ana taarifa yake ya kifedha.',
  },
  {
    pattern: /due|when|lini/i,
    cites: ['act-34'],
    en: 'An initial declaration is due within 30 days of your appointment. A biennial declaration is made as at 1 November of the declaration year and is due by the end of December.',
    sw: 'Tamko la kwanza linapaswa kuwasilishwa ndani ya siku 30 baada ya uteuzi wako. Tamko la kila baada ya miaka miwili linahusu hali yako kufikia tarehe 1 Novemba ya mwaka wa tamko na linawasilishwa kabla ya mwisho wa Desemba.',
  },
];

function toPassage(item: CorpusPassage, language: Language, text?: string): HelpPassage {
  const swahili = language === 'sw' && item.text[1] !== null;
  return {
    id: item.id,
    source: item.source,
    citation: item.citation,
    title: (language === 'sw' ? item.title[1] : null) ?? item.title[0],
    snippet: text ?? (swahili ? (item.text[1] ?? item.text[0]) : item.text[0]),
    language: swahili ? 'sw' : 'en',
  };
}

function view(conversation: Conversation): AssistantConversation {
  return {
    id: conversation.id,
    declarationId: conversation.declarationId,
    language: conversation.language,
    messages: conversation.messages,
    expiresAt:
      conversation.declarationId === null
        ? new Date(conversation.lastMessageAt + EXPIRY_MS).toISOString()
        : null,
  };
}

const notFound = () => problem(404, 'Not found, or not visible to the caller');
const isLanguage = (value: unknown): value is Language => value === 'en' || value === 'sw';

/** A draft the mock holds that is no longer being edited has lost its conversation. */
function draftGone(declarationId: string | null) {
  if (declarationId === null) return false;
  const stored = store.get(declarationId);
  return stored !== undefined && stored.status !== 'draft' && stored.status !== 'amending';
}

/** `POST /v1/me/assistant/conversations` */
export async function openConversation(request: Request, caller: string | null) {
  const body = await readJson(request);
  if (!caller) return notFound();
  if (!isRecord(body) || !isLanguage(body.language)) return problem(400, 'Invalid request');
  const declarationId = typeof body.declarationId === 'string' ? body.declarationId : null;
  const stored = declarationId ? store.get(declarationId) : undefined;
  if ((stored && stored.owner !== caller) || draftGone(declarationId)) return notFound();

  let conversation = [...conversations.values()].find(
    (candidate) => candidate.owner === caller && candidate.declarationId === declarationId,
  );
  if (conversation?.declarationId === null) {
    if (Date.now() - conversation.lastMessageAt > EXPIRY_MS) {
      conversations.delete(conversation.id);
      conversation = undefined;
    }
  }
  if (!conversation) {
    conversation = {
      id: crypto.randomUUID(),
      owner: caller,
      declarationId,
      language: body.language,
      messages: [],
      lastMessageAt: Date.now(),
    };
    conversations.set(conversation.id, conversation);
  }
  conversation.language = body.language;
  return json(200, view(conversation));
}

function ownConversation(caller: string | null, id: string) {
  const conversation = conversations.get(id);
  if (!caller || conversation?.owner !== caller || draftGone(conversation.declarationId)) {
    return null;
  }
  return conversation;
}

function message(
  role: AssistantMessage['role'],
  text: string,
  extra: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    citations: [],
    sectionLink: null,
    declined: false,
    reportingOfficer: null,
    label: null,
    rating: null,
    at: new Date().toISOString(),
    ...extra,
  };
}

/** What Adili answers: a grounded canned answer, or the decline. */
function answerFor(conversation: Conversation, question: string): AssistantMessage {
  const { language } = conversation;
  const canned = ANSWERS.find((candidate) => candidate.pattern.test(question));
  const stored = conversation.declarationId ? store.get(conversation.declarationId) : undefined;
  if (!canned) {
    const slug = stored?.header.commission.slug ?? 'tsc';
    return message('assistant', DECLINE[language], {
      declined: true,
      reportingOfficer: REPORTING_OFFICERS[slug] ?? null,
    });
  }
  return message('assistant', canned[language], {
    citations: canned.cites.map((id) => toPassage(passage(id), language)),
    sectionLink: conversation.declarationId && canned.link ? canned.link(stored) : null,
    label: {
      aiAssisted: true,
      task: 'answer-declarant-question',
      promptVersion: 1,
      provider: 'anthropic',
      model: 'claude-opus-5',
      generatedAt: new Date().toISOString(),
      disclaimer: DISCLAIMER[language],
    },
  });
}

const sleep = (milliseconds: number) =>
  milliseconds > 0
    ? new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();

function frame(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** `POST /v1/me/assistant/conversations/{id}/messages`: the answer as server-sent events. */
export async function ask(request: Request, caller: string | null, conversationId: string) {
  const conversation = ownConversation(caller, conversationId);
  const body = await readJson(request);
  if (!conversation) return notFound();
  if (!isRecord(body) || typeof body.text !== 'string' || !body.text.trim()) {
    return problem(400, 'Invalid request');
  }
  if (mode === 'rate-limited') {
    return json(
      429,
      {
        type: 'about:blank',
        title: 'Too many requests',
        status: 429,
        code: 'rate-limit-exceeded',
        retryAfterSeconds: RETRY_AFTER_SECONDS,
      },
      { 'retry-after': String(RETRY_AFTER_SECONDS) },
    );
  }
  if (mode === 'unavailable') {
    return json(503, {
      type: 'assistant-unavailable',
      title: 'Answers are unavailable right now',
      status: 503,
    });
  }

  const question = message('user', body.text.trim());
  const answer = answerFor(conversation, question.text);
  const failMidway = mode === 'fail-midway';
  const encoder = new TextEncoder();
  const signal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        controller.enqueue(encoder.encode(text));
      };
      send(': ping\n\n');
      await sleep(pace * 12);
      if (!answer.declined) {
        const words = answer.text.split(/(?<=\s)/);
        const stopAt = failMidway ? Math.ceil(words.length / 2) : words.length;
        for (const word of words.slice(0, stopAt)) {
          if (signal.aborted) {
            controller.close();
            return;
          }
          send(frame('delta', { text: word }));
          await sleep(pace);
        }
      }
      if (signal.aborted) {
        controller.close();
        return;
      }
      if (failMidway) {
        send(frame('error', { code: 'assistant-unavailable' }));
      } else {
        conversation.messages.push(question, answer);
        conversation.lastMessageAt = Date.now();
        send(frame('final', { question, answer }));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
  });
}

/** `PUT .../messages/{messageId}/feedback` */
export async function rate(
  request: Request,
  caller: string | null,
  conversationId: string,
  messageId: string,
) {
  const conversation = ownConversation(caller, conversationId);
  const body = await readJson(request);
  const target = conversation?.messages.find(
    (candidate) => candidate.id === messageId && candidate.role === 'assistant',
  );
  if (!target) return notFound();
  if (!isRecord(body) || (body.rating !== 'helpful' && body.rating !== 'not-helpful')) {
    return problem(400, 'Invalid request');
  }
  target.rating = body.rating;
  return new Response(null, { status: 200 });
}

const STOP_WORDS = new Set(['the', 'and', 'my', 'do', 'is', 'of', 'ya', 'na', 'je', 'a', 'i']);

/** `GET /v1/help/search`: deterministic word match, the section's passages ranked higher. */
export function searchHelp(url: URL, caller: string | null) {
  if (!caller) return notFound();
  const q = url.searchParams.get('q') ?? '';
  const language = url.searchParams.get('language');
  if (q.trim().length < 2 || !isLanguage(language)) return problem(400, 'Invalid request');
  const sectionKey = url.searchParams.get('sectionKey');
  const kind = sectionKey?.startsWith('statement:') ? 'statement' : sectionKey;
  const words = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  const ranked = CORPUS.map((item) => {
    const haystack = [item.citation, ...item.title, ...item.text]
      .filter((part): part is string => part !== null)
      .join(' ')
      .toLowerCase();
    const hits = words.filter((word) => haystack.includes(word)).length;
    return { item, hits, score: hits + (kind && item.tags.includes(kind) ? 0.5 : 0) };
  })
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  return json(
    200,
    ranked.map(({ item }) => toPassage(item, language)),
  );
}
