import { z } from 'zod';

import { commissionTypeSchema } from './create-commission.js';

/** Query of `GET /v1/commissions`. */
export const listCommissionsQuery = z.object({
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => (value === '' ? undefined : value))
    .meta({ description: 'Case-insensitive match on name or slug; blank means no search' }),
  type: commissionTypeSchema.optional(),
  reportingOfficer: z.enum(['none', 'invited', 'activated']).optional().meta({
    description: 'Filter by current reporting officer state; `none` means no assignment yet',
  }),
  cursor: z
    .string()
    .max(500)
    .optional()
    .meta({ description: '`nextCursor` of the previous page; omit for the first page' }),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type ListCommissionsQuery = z.infer<typeof listCommissionsQuery>;

/** Position after the last item of a page. Opaque to clients: base64url of `[name, id]`. */
export interface Cursor {
  name: string;
  id: string;
}

const cursorPayload = z.tuple([z.string(), z.uuid()]);

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.name, cursor.id])).toString('base64url');
}

/** The decoded cursor, or null when it was not issued by `encodeCursor`. */
export function decodeCursor(value: string): Cursor | null {
  try {
    const parsed = cursorPayload.safeParse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    return parsed.success ? { name: parsed.data[0], id: parsed.data[1] } : null;
  } catch {
    return null;
  }
}
