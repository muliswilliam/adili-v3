import { z } from 'zod';

import { CASE_STATUSES, DECLARATION_TYPES, PRIORITY_BANDS } from './schema.js';

const flag = (description: string) =>
  z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true'))
    .meta({ description });

/** Query of `GET /v1/commissions/{slug}/review/queue` (review.yaml `listReviewQueue`). */
export const queueQuery = z.object({
  status: z.enum(CASE_STATUSES).optional(),
  band: z.enum(PRIORITY_BANDS).optional(),
  type: z.enum(DECLARATION_TYPES).optional(),
  cycle: z.coerce
    .number()
    .int()
    .min(2000)
    .max(2999)
    .optional()
    .meta({ description: "The statement date's year" }),
  assignee: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .meta({ description: '`mine`, `unassigned`, `any` (the default), or a subject id' }),
  late: flag('Only cases filed late, or only those filed on time'),
  openClarification: flag('Only cases with an open clarification, or only those without'),
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
  cursor: z
    .string()
    .max(500)
    .optional()
    .meta({ description: '`nextCursor` of the previous page; omit for the first page' }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type QueueQuery = z.infer<typeof queueQuery>;

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
