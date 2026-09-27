import { z } from 'zod';

import { todayInNairobi } from '../row-validation.js';

/**
 * Request and response shapes of confirming exits and keeping flagged records (spec #27). They
 * are the contract: the OpenAPI document is generated from them.
 */

/** Records one request may exit or keep, like a batch of rows. */
export const MAX_RECORDS_PER_REQUEST = 1000;

/** An exit date: a calendar date, not after today in Kenya. */
export const exitDateSchema = z.iso
  .date()
  .refine((date) => date <= todayInNairobi(), { message: 'Exit date cannot be in the future' })
  .meta({ description: 'Last day of employment; not in the future (Africa/Nairobi)' });

export const confirmExitsBody = z
  .object({
    records: z
      .array(
        z.object({
          recordId: z.uuid(),
          exitDate: exitDateSchema.optional().meta({
            description:
              'Overrides the batch `exitDate` for this record. Not in the future (Africa/Nairobi)',
          }),
        }),
      )
      .min(1)
      .max(MAX_RECORDS_PER_REQUEST)
      .meta({ description: 'Records to exit; each at most once, none already exited' }),
    exitDate: exitDateSchema.optional().meta({
      description:
        'Exit date of the records without their own; required unless every record has one. Not in the future (Africa/Nairobi)',
    }),
  })
  .superRefine((body, context) => {
    const seen = new Set<string>();
    body.records.forEach((record, index) => {
      if (seen.has(record.recordId)) {
        context.addIssue({
          code: 'custom',
          path: ['records', index, 'recordId'],
          message: 'Record listed twice',
        });
      }
      seen.add(record.recordId);
    });
    if (body.exitDate === undefined && body.records.some((record) => !record.exitDate)) {
      context.addIssue({
        code: 'custom',
        path: ['exitDate'],
        message: 'Enter an exit date, or one for every record',
      });
    }
  });
export type ConfirmExitsBody = z.infer<typeof confirmExitsBody>;

export const exitsResultSchema = z.object({
  batchId: z.uuid().meta({
    description: 'Identifies this confirmation, as in the `roster.exits.confirmed.v1` event',
  }),
  count: z.int().meta({ description: 'Records now exited' }),
});
export type ExitsResult = z.infer<typeof exitsResultSchema>;

export const keepRosterRecordsBody = z.object({
  recordIds: z
    .array(z.uuid())
    .min(1)
    .max(MAX_RECORDS_PER_REQUEST)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Records listed twice' })
    .meta({ description: 'Records whose officers are still employed' }),
});
export type KeepRosterRecordsBody = z.infer<typeof keepRosterRecordsBody>;

export const keepResultSchema = z.object({
  count: z.int().meta({
    description:
      'Records whose flag was cleared; records that were not flagged are left as they are',
  }),
});
export type KeepResult = z.infer<typeof keepResultSchema>;

/** Body of `recordRosterExit`: an HR system recording one officer's exit. */
export const recordRosterExitBody = z.object({ exitDate: exitDateSchema });
export type RecordRosterExitBody = z.infer<typeof recordRosterExitBody>;

/** The `fileNumber` path parameter of `recordRosterExit`: matched trimmed, case-insensitively. */
export const fileNumberParam = z.string().trim().min(1).max(30);
