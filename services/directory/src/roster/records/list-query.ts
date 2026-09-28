import { z } from 'zod';

import { rosterRecordStateSchema } from './representation.js';

/** Query of `GET /v1/commissions/{slug}/roster/records`. */
export const listRosterRecordsQuery = z.object({
  search: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value === '' ? undefined : value))
    .meta({
      description:
        'A personnel file number or its beginning, part of a name (both case-insensitive), or a full national ID; blank means no search',
    }),
  state: rosterRecordStateSchema.optional(),
  flagged: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true'))
    .meta({
      description:
        'Only records flagged as absent from the latest complete import, or only those not flagged',
    }),
  cursor: z
    .string()
    .max(500)
    .optional()
    .meta({ description: '`nextCursor` of the previous page; omit for the first page' }),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type ListRosterRecordsQuery = z.infer<typeof listRosterRecordsQuery>;

/** A national ID as the parser normalises it: 5 to 10 digits once spaces are removed. */
export function asNationalId(search: string): string | undefined {
  const digits = search.replace(/\s+/g, '');
  return /^\d{5,10}$/.test(digits) ? digits : undefined;
}
