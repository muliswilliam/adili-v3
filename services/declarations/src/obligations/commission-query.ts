import { z } from 'zod';

import { OBLIGATION_STATUS_VALUES, OBLIGATION_TYPE_VALUES } from './schema.js';

/** A biennial cycle key, `biennial:<year>`. */
export const BIENNIAL_CYCLE_KEY = /^biennial:(\d{4})$/;

const cycleParameter = z
  .string()
  .regex(BIENNIAL_CYCLE_KEY)
  .optional()
  .meta({
    description: 'A biennial cycle key, e.g. `biennial:2027`; the current cycle when omitted',
    examples: ['biennial:2027'],
  });

/** Query of the Commission and national summaries. */
export const summaryQuery = z.object({ cycle: cycleParameter });

export type SummaryQuery = z.infer<typeof summaryQuery>;

/** Query of `GET /v1/commissions/{slug}/obligations`. */
export const listCommissionObligationsQuery = z.object({
  type: z.enum(OBLIGATION_TYPE_VALUES).optional(),
  status: z
    .enum(OBLIGATION_STATUS_VALUES)
    .optional()
    .meta({ description: 'Only obligations with this status; cancelled ones only when asked for' }),
  onboarded: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true'))
    .meta({ description: 'Only officers who have onboarded, or only those who have not' }),
  cycle: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .optional()
    .meta({
      description: 'Only obligations with this cycle key',
      examples: ['biennial:2027', 'initial:2027-03-10'],
    }),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => (value === '' ? undefined : value))
    .meta({
      description:
        'A personnel file number or its beginning, or part of a name (both case-insensitive); blank means no search',
    }),
  cursor: z
    .string()
    .max(500)
    .optional()
    .meta({ description: '`nextCursor` of the previous page; omit for the first page' }),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type ListCommissionObligationsQuery = z.infer<typeof listCommissionObligationsQuery>;

/**
 * Position after the last item of a page, in the list's order: overdue first (`rank` 0, then 1),
 * then due date, then id. Opaque to clients: base64url of `[rank, dueDate, id]`.
 */
export interface ListCursor {
  rank: 0 | 1;
  dueDate: string;
  id: string;
}

const cursorPayload = z.tuple([z.union([z.literal(0), z.literal(1)]), z.iso.date(), z.uuid()]);

export function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify([cursor.rank, cursor.dueDate, cursor.id])).toString(
    'base64url',
  );
}

/** The decoded cursor, or null when it was not issued by `encodeListCursor`. */
export function decodeListCursor(value: string): ListCursor | null {
  try {
    const parsed = cursorPayload.safeParse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    return parsed.success
      ? { rank: parsed.data[0], dueDate: parsed.data[1], id: parsed.data[2] }
      : null;
  } catch {
    return null;
  }
}
