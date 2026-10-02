import { z } from 'zod';

/** Records per page of a pull: one page is one transaction of the consumer (spec 04). */
export const MAX_PULL_PAGE = 1000;

/** Records per page of a search: what a person picks from (spec 10, officer resolution). */
export const MAX_SEARCH_PAGE = 50;

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
    search: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .optional()
      .meta({
        description: `A personnel file number or its beginning, or part of a name (both case-insensitive): the records that match, ordered by full name, up to ${String(MAX_SEARCH_PAGE)} per page. E.g. the access service resolving the officer a Form K names (spec 10). No national ID search.`,
      }),
    cursor: z
      .string()
      .max(500)
      .optional()
      .meta({ description: '`nextCursor` of the previous page; omit for the first page' }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PULL_PAGE)
      .optional()
      .meta({
        description: `Records per page: up to ${String(MAX_PULL_PAGE)} (default) for an import or exit batch, ${String(MAX_SEARCH_PAGE)} (default) for a search`,
      }),
  })
  .refine(
    (query) =>
      [query.importId, query.exitBatchId, query.search].filter((given) => given !== undefined)
        .length === 1,
    { message: 'Give exactly one of importId, exitBatchId and search', path: ['importId'] },
  )
  .refine((query) => query.search === undefined || (query.limit ?? 0) <= MAX_SEARCH_PAGE, {
    message: `A search gives at most ${String(MAX_SEARCH_PAGE)} records per page`,
    path: ['limit'],
  });

export type InternalListRosterRecordsQuery = z.infer<typeof internalListRosterRecordsQuery>;

/**
 * Position after the last record of a page: the import row's number, the record id of an exit
 * batch, or the full name and id of a search's last record. Opaque to clients: base64url of
 * `[kind, ...position]`.
 */
export type PullCursor =
  | { kind: 'row'; rowNumber: number }
  | { kind: 'record'; recordId: string }
  | { kind: 'name'; fullName: string; recordId: string };

const cursorPayload = z.union([
  z.tuple([z.literal('row'), z.int().nonnegative()]),
  z.tuple([z.literal('record'), z.uuid()]),
  z.tuple([z.literal('name'), z.string(), z.uuid()]),
]);

export function encodePullCursor(cursor: PullCursor): string {
  const payload =
    cursor.kind === 'row'
      ? ['row', cursor.rowNumber]
      : cursor.kind === 'record'
        ? ['record', cursor.recordId]
        : ['name', cursor.fullName, cursor.recordId];
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
    switch (payload[0]) {
      case 'row':
        return { kind: 'row', rowNumber: payload[1] };
      case 'record':
        return { kind: 'record', recordId: payload[1] };
      case 'name':
        return { kind: 'name', fullName: payload[1], recordId: payload[2] };
    }
  } catch {
    return null;
  }
}
