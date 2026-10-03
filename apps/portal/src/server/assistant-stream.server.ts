import { z } from 'zod';

import { isSectionKey } from '../declaration/section-key';
import { askAssistant } from './assistant.server';
import type { DeclarationsClient } from './declarations/client.server';
import type { AssistantItemType } from './declarations/types';

/**
 * The browser's side of an Ask Adili answer: `POST /api/assistant/conversations/{id}/messages`
 * relays the declarations service's server-sent events as they come, with the access token kept
 * on the server. Anything but a stream answers JSON `{status}` the panel branches on: 401 when
 * the session has ended, 404, 429 `{retryAfterSeconds}`, 503 when answers are unavailable (the
 * panel then offers help search). Same-origin JSON only: a cross-site form cannot post it.
 */

const ITEM_TYPES = [
  'land',
  'building',
  'vehicle',
  'securities',
  'shareholding',
  'bank-account',
  'cash',
  'receivable',
  'mortgage',
  'loan',
  'guarantee',
  'salary-emoluments',
  'allowances',
  'business',
  'rent',
  'dividends-interest',
  'pension',
  'farming',
  'consultancy',
] as const satisfies readonly AssistantItemType[];

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
  const origin = request.headers.get('origin');
  if (
    (origin !== null && origin !== new URL(appOrigin).origin) ||
    !request.headers.get('content-type')?.startsWith('application/json')
  ) {
    return status(403, { status: 'forbidden' });
  }
  if (!z.uuid().safeParse(conversationId).success) return status(404, { status: 'not-found' });
  if (!client) return status(401, { status: 'unauthenticated' });
  const body = question.safeParse(await request.json().catch(() => null));
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
