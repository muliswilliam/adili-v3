import type { DeclarationsClient } from './declarations/client.server';
import type {
  AssistantConversation,
  AssistantItemType,
  AssistantLanguage,
  HelpPassage,
} from './declarations/types';
import { attempt, type NotFound, notFound, type Unavailable, unavailable } from './results';

/**
 * Ask Adili's calls to the declarations service (spec 11, #333), reduced to results the panel and
 * the streaming route branch on. Pure: the caller injects the client (`assistant.ts` holds the
 * server functions, `routes/api/assistant...messages.ts` the stream).
 */

export type OpenResult =
  { status: 'ok'; conversation: AssistantConversation } | NotFound | Unavailable;

export function openConversation(
  client: DeclarationsClient,
  body: { declarationId: string | null; language: AssistantLanguage },
): Promise<OpenResult> {
  return attempt(async () => {
    const { data, response } = await client.POST('/v1/me/assistant/conversations', { body });
    if (data) return { status: 'ok', conversation: data };
    return response.status === 404 ? notFound : unavailable;
  });
}

export interface AskBody {
  text: string;
  sectionKey: string | null;
  itemType: AssistantItemType | null;
}

export type AskResult =
  /** The answer's server-sent events, to relay as they come. */
  | { status: 'streaming'; body: ReadableStream<Uint8Array> }
  /** 429: asked too often; ask again after this many seconds. */
  | { status: 'rate-limited'; retryAfterSeconds: number }
  /** 400: the question was refused as sent. */
  | { status: 'invalid' }
  | NotFound
  /** 503 `assistant-unavailable`, or the service could not be reached: use help search. */
  | Unavailable;

function retryAfter(response: Response, problem: unknown): number {
  const fromBody =
    typeof problem === 'object' && problem !== null && 'retryAfterSeconds' in problem
      ? Number(problem.retryAfterSeconds)
      : NaN;
  const seconds = Number.isFinite(fromBody)
    ? fromBody
    : Number(response.headers.get('retry-after') ?? NaN);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60;
}

/**
 * Asks a question. `signal` is the declarant's request: when they leave, the service's stream is
 * cancelled and, as the contract says, nothing is stored.
 */
export function askAssistant(
  client: DeclarationsClient,
  conversationId: string,
  body: AskBody,
  signal?: AbortSignal,
): Promise<AskResult> {
  return attempt(async (): Promise<AskResult> => {
    const { response, error } = await client.POST(
      '/v1/me/assistant/conversations/{conversationId}/messages',
      {
        params: { path: { conversationId } },
        body,
        parseAs: 'stream',
        headers: { accept: 'text/event-stream' },
        ...(signal ? { signal } : {}),
      },
    );
    if (response.ok && response.body) return { status: 'streaming', body: response.body };
    if (response.status === 429) {
      return { status: 'rate-limited', retryAfterSeconds: retryAfter(response, error) };
    }
    if (response.status === 400) return { status: 'invalid' };
    return response.status === 404 ? notFound : unavailable;
  });
}

export interface FeedbackBody {
  rating: 'helpful' | 'not-helpful';
  reason: 'inaccurate' | 'missed-something' | 'unclear' | 'too-long' | 'other' | null;
  note: string | null;
}

export type RateResult = { status: 'rated' } | NotFound | Unavailable;

export function rateAnswer(
  client: DeclarationsClient,
  conversationId: string,
  messageId: string,
  body: FeedbackBody,
): Promise<RateResult> {
  return attempt(async (): Promise<RateResult> => {
    const { response } = await client.PUT(
      '/v1/me/assistant/conversations/{conversationId}/messages/{messageId}/feedback',
      { params: { path: { conversationId, messageId } }, body },
    );
    if (response.ok) return { status: 'rated' };
    return response.status === 404 ? notFound : unavailable;
  });
}

export type HelpSearchResult = { status: 'ok'; passages: HelpPassage[] } | Unavailable;

export function searchHelp(
  client: DeclarationsClient,
  query: { q: string; language: AssistantLanguage; sectionKey: string | null },
): Promise<HelpSearchResult> {
  return attempt(async (): Promise<HelpSearchResult> => {
    const { data } = await client.GET('/v1/help/search', {
      params: {
        query: {
          q: query.q,
          language: query.language,
          ...(query.sectionKey ? { sectionKey: query.sectionKey } : {}),
        },
      },
    });
    return data ? { status: 'ok', passages: data } : unavailable;
  });
}
