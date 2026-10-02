import { z } from 'zod';

import { CASE_STATUSES, DECLARATION_TYPES, PRIORITY_BANDS } from './schema.js';

const LATE = 'Only cases filed late, or only those filed on time';
const OPEN_CLARIFICATION = 'Only cases with an open clarification, or only those without';
const REGISTRY_UNAVAILABLE =
  'Only cases where a registry could not be checked at the latest registry check, or only the others';

/** A switch in the query string: `true` or `false`. */
const queryFlag = (description: string) =>
  z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true'))
    .meta({ description });

const bodyFlag = (description: string) => z.boolean().optional().meta({ description });

/**
 * The filters both ways of reading the queue share, with the cycle as each reads it (a query
 * string's is text).
 */
const filters = <C extends z.ZodType>(cycle: C) => ({
  status: z.enum(CASE_STATUSES).optional(),
  band: z.enum(PRIORITY_BANDS).optional(),
  type: z.enum(DECLARATION_TYPES).optional(),
  cycle,
  assignee: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .meta({ description: '`mine`, `unassigned`, `any` (the default), or a subject id' }),
  cursor: z
    .string()
    .max(500)
    .optional()
    .meta({ description: '`nextCursor` of the previous page; omit for the first page' }),
});

/**
 * Query of `GET /v1/commissions/{slug}/review/queue` (review.yaml `listReviewQueue`): the
 * filters without the search text, which is personal data (a name, say) and so is never in a
 * URL, where access logs and trace attributes would keep it. It goes in the body of
 * `searchReviewQueue`; a `search` here is ignored.
 */
export const queueListQuery = z.object({
  ...filters(
    z.coerce
      .number()
      .int()
      .min(2000)
      .max(2999)
      .optional()
      .meta({ description: "The statement date's year" }),
  ),
  late: queryFlag(LATE),
  openClarification: queryFlag(OPEN_CLARIFICATION),
  registryUnavailable: queryFlag(REGISTRY_UNAVAILABLE),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Body of `POST /v1/commissions/{slug}/review/queue/search` (review.yaml `searchReviewQueue`):
 * every filter of the queue with the search text.
 */
export const queueSearchBody = z.object({
  ...filters(
    z.int().min(2000).max(2999).optional().meta({ description: "The statement date's year" }),
  ),
  late: bodyFlag(LATE),
  openClarification: bodyFlag(OPEN_CLARIFICATION),
  registryUnavailable: bodyFlag(REGISTRY_UNAVAILABLE),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => (value === '' ? undefined : value))
    .meta({
      description:
        'A reference or personnel file number or their beginning, or part of a name (case-insensitive)',
    }),
  limit: z.int().min(1).max(100).default(50),
});

/** The queue's filters, search text and page, read from either. */
export type QueueQuery = z.infer<typeof queueSearchBody>;

/**
 * Position after the last case of a page, in the queue's order: score descending, then received
 * at, then id. Opaque to clients: base64url of `[score, receivedAt, id]`.
 */
export interface QueueCursor {
  score: number;
  receivedAt: string;
  id: string;
}

const cursorPayload = z.tuple([z.int(), z.iso.datetime({ offset: true }), z.uuid()]);

export function encodeQueueCursor(cursor: QueueCursor): string {
  return Buffer.from(JSON.stringify([cursor.score, cursor.receivedAt, cursor.id])).toString(
    'base64url',
  );
}

/** The decoded cursor, or null when it was not issued by `encodeQueueCursor`. */
export function decodeQueueCursor(value: string): QueueCursor | null {
  try {
    const parsed = cursorPayload.safeParse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    return parsed.success
      ? { score: parsed.data[0], receivedAt: parsed.data[1], id: parsed.data[2] }
      : null;
  } catch {
    return null;
  }
}
