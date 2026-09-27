import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { asViewer } from './as-viewer.server';
import {
  callDirectory,
  type ConfirmExits,
  type DirectoryResult,
  type ExitsResult,
  type KeepResult,
} from './directory/client';

/** The viewer's own Commission: roster routes carry no slug, the session's tenant names it. */
const slug = z.string().min(1).max(40);
/** A calendar date as the date input gives it; the directory checks it is not in the future. */
const date = z.iso.date();
/** The directory takes up to 1,000 records per call. */
const recordIds = z.array(z.uuid()).min(1).max(1000);

export const confirmRosterExitsInput = z.object({
  slug,
  /** One per dialog submission, reused on retry (spec 02). */
  idempotencyKey: z.uuid(),
  exits: z.object({
    exitDate: date.optional(),
    records: z
      .array(z.object({ recordId: z.uuid(), exitDate: date.optional() }))
      .min(1)
      .max(1000),
  }) satisfies z.ZodType<ConfirmExits>,
});

/**
 * `POST /v1/commissions/{slug}/roster/exits` with the dialog's Idempotency-Key: every record
 * exits, or none does. 409 `record-exited` / 404 `record-not-found` point at the records that
 * changed since the page loaded; 400 at a missing or future date.
 */
export const confirmRosterExits = createServerFn({ method: 'POST' })
  .validator(confirmRosterExitsInput)
  .handler(({ data }): Promise<DirectoryResult<ExitsResult>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.POST('/v1/commissions/{slug}/roster/exits', {
          params: {
            path: { slug: data.slug },
            header: { 'Idempotency-Key': data.idempotencyKey },
          },
          body: data.exits,
        }),
      ),
    ),
  );

export const keepRosterRecordsInput = z.object({
  slug,
  idempotencyKey: z.uuid(),
  recordIds,
});

/**
 * `POST /v1/commissions/{slug}/roster/keep`: these officers are still employed, so their absent
 * flag is cleared. Records that are no longer flagged are left as they are (not counted).
 */
export const keepRosterRecords = createServerFn({ method: 'POST' })
  .validator(keepRosterRecordsInput)
  .handler(({ data }): Promise<DirectoryResult<KeepResult>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.POST('/v1/commissions/{slug}/roster/keep', {
          params: {
            path: { slug: data.slug },
            header: { 'Idempotency-Key': data.idempotencyKey },
          },
          body: { recordIds: data.recordIds },
        }),
      ),
    ),
  );
