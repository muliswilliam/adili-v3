import { z } from 'zod';

/** Records per page of a pull: one page is one transaction of the consumer (spec 04). */
export const MAX_PULL_PAGE = 1000;

/** Query of `GET /internal/v1/commissions/{slug}/roster/records`. */
export const internalListRosterRecordsQuery = z
  .object({
    importId: z.uuid().optional().meta({
      description:
        'The records the import had a row for (`roster.import.completed.v1`), in row order. Import rows are kept 30 days after the import ends.',
    }),
    exitBatchId: z.uuid().optional().meta({
      description:
        'The records the exit confirmation exited (`roster.exits.confirmed.v1` `batchId`), in id order',
    }),
    cursor: z
      .string()
      .max(500)
      .optional()
      .meta({ description: '`nextCursor` of the previous page; omit for the first page' }),
    limit: z.coerce.number().int().min(1).max(MAX_PULL_PAGE).default(MAX_PULL_PAGE),
  })
  .refine((query) => (query.importId === undefined) !== (query.exitBatchId === undefined), {
    message: 'Give exactly one of importId and exitBatchId',
    path: ['importId'],
  });

export type InternalListRosterRecordsQuery = z.infer<typeof internalListRosterRecordsQuery>;

/**
 * Position after the last record of a page: the import row's number, or the record id of an
 * exit batch. Opaque to clients: base64url of `[kind, position]`.
 */
export type PullCursor = { kind: 'row'; rowNumber: number } | { kind: 'record'; recordId: string };

const cursorPayload = z.union([
  z.tuple([z.literal('row'), z.int().nonnegative()]),
  z.tuple([z.literal('record'), z.uuid()]),
]);

export function encodePullCursor(cursor: PullCursor): string {
  const payload = cursor.kind === 'row' ? ['row', cursor.rowNumber] : ['record', cursor.recordId];
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/** The decoded cursor, or null when it was not issued by `encodePullCursor`. */
export function decodePullCursor(value: string): PullCursor | null {
  try {
    const parsed = cursorPayload.safeParse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    if (!parsed.success) return null;
    const payload = parsed.data;
    return payload[0] === 'row'
      ? { kind: 'row', rowNumber: payload[1] }
      : { kind: 'record', recordId: payload[1] };
  } catch {
    return null;
  }
}
