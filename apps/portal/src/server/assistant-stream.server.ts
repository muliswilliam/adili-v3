import { z } from 'zod';

import { isSectionKey } from '../declaration/section-key';
import { askAssistant } from './assistant.server';
import type { DeclarationsClient } from './declarations/client.server';
import type { AssistantItemType } from './declarations/types';

/**
 * The browser's side of an Ask Adili answer: `POST /api/assistant/conversations/{id}/messages`
 * relays the declarations service's server-sent events as they come, with the access token kept
 * on the server. Anything but a stream answers JSON `{status}` the panel branches on: 401 when
 * the session has ended, 404, 413 for a body past 16 KB, 429 `{retryAfterSeconds}`, 503 when
 * answers are unavailable (the panel then offers help search). Same-origin JSON only: a cross-site
 * form cannot post it, and a request without an Origin is refused.
 */

// Every item type the contract has, checked both ways by the Record's keys.
const ITEM_TYPE_SET: Record<AssistantItemType, true> = {
  land: true,
  building: true,
  vehicle: true,
  securities: true,
  shareholding: true,
  'bank-account': true,
  cash: true,
  receivable: true,
  mortgage: true,
  loan: true,
  guarantee: true,
  'salary-emoluments': true,
  allowances: true,
  business: true,
  rent: true,
  'dividends-interest': true,
  pension: true,
  farming: true,
  consultancy: true,
};
const ITEM_TYPES = Object.keys(ITEM_TYPE_SET) as [AssistantItemType, ...AssistantItemType[]];

/** Largest question body taken: a 2,000-character question with its section, with room. */
const MAX_BODY_BYTES = 16_384;

const question = z.object({
  text: z.string().trim().min(1).max(2000),
  sectionKey: z.string().refine(isSectionKey).nullable(),
  itemType: z.enum(ITEM_TYPES).nullable(),
});

export type AskQuestion = z.infer<typeof question>;

const status = (code: number, body: object) =>
  Response.json(body, { status: code, headers: { 'cache-control': 'no-store' } });

export async function relayAnswer(
  request: Request,
  conversationId: string,
  client: DeclarationsClient | null,
  appOrigin: string,
): Promise<Response> {
  // Browsers send Origin on every POST; a request without one is not the panel's.
  if (
    request.headers.get('origin') !== new URL(appOrigin).origin ||
    !request.headers.get('content-type')?.startsWith('application/json')
  ) {
    return status(403, { status: 'forbidden' });
  }
  if (!z.uuid().safeParse(conversationId).success) return status(404, { status: 'not-found' });
  if (!client) return status(401, { status: 'unauthenticated' });
  const raw = await readLimited(request, MAX_BODY_BYTES);
  if (raw === null) return status(413, { status: 'too-large' });
  const body = question.safeParse(parseJson(raw));
  if (!body.success) return status(400, { status: 'invalid' });

  const result = await askAssistant(client, conversationId, body.data, request.signal);
  switch (result.status) {
    case 'streaming':
      return new Response(result.body, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-store',
          'x-accel-buffering': 'no',
        },
      });
    case 'rate-limited':
      return status(429, result);
    case 'invalid':
      return status(400, result);
    case 'not-found':
      return status(404, result);
    case 'unavailable':
      return status(503, result);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The body as text, or null once it passes `limit` bytes (read no further than that). */
async function readLimited(request: Request, limit: number): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
