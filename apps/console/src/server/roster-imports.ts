import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { importRunning } from '../components/roster/import-report';
import { commissionSlug } from './commission-slug';
import { asViewer } from './as-viewer.server';
import {
  callDirectory,
  type DirectoryResult,
  type RosterImport,
  type RosterImportPage,
  type RosterImportPreview,
  type RosterImportRowPage,
  type RosterSummary,
} from './directory/client';

/** Imports per page of the import history. */
export const IMPORT_HISTORY_PAGE_SIZE = 20;

/** Rejected rows per page of an import's report (spec 02). */
export const REJECTED_ROWS_PAGE_SIZE = 50;

/** What the wizard's column check shows about a clean upload. */
export interface RosterUploadCheck {
  preview: RosterImportPreview;
  /**
   * The Commission's current roster, for the "complete roster" default; null when it could not
   * be read (the check still works, the box then starts unticked).
   */
  roster: RosterSummary | null;
}

/**
 * `POST /v1/commissions/{slug}/roster/imports/preview` for a clean upload: the file's column
 * mapping and a row estimate, read from its header without staging anything. Alongside, the
 * Commission's roster summary, whose emptiness sets the "complete roster" default.
 */
export const checkRosterUpload = createServerFn({ method: 'POST' })
  .validator(z.object({ slug: commissionSlug, uploadId: z.uuid() }))
  .handler(({ data }): Promise<DirectoryResult<RosterUploadCheck>> =>
    asViewer(async (client) => {
      const [preview, commission] = await Promise.all([
        callDirectory(() =>
          client.POST('/v1/commissions/{slug}/roster/imports/preview', {
            params: { path: { slug: data.slug } },
            body: { uploadId: data.uploadId },
          }),
        ),
        callDirectory(() =>
          client.GET('/v1/commissions/{slug}', { params: { path: { slug: data.slug } } }),
        ),
      ]);
      if (!preview.ok) return preview;
      return {
        ok: true,
        data: { preview: preview.data, roster: commission.ok ? commission.data.roster : null },
      };
    }),
  );

/**
 * `POST /v1/commissions/{slug}/roster/imports` for a clean upload (202 with the pending import).
 * The Idempotency-Key is the check step's, reused on retry so a timed-out start is not doubled.
 * 409 `import-in-progress` when another import runs, 429 when rate limited.
 */
export const startRosterImport = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      slug: commissionSlug,
      idempotencyKey: z.uuid(),
      uploadId: z.uuid(),
      declaredComplete: z.boolean(),
    }),
  )
  .handler(({ data }): Promise<DirectoryResult<RosterImport>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.POST('/v1/commissions/{slug}/roster/imports', {
          params: {
            path: { slug: data.slug },
            header: { 'Idempotency-Key': data.idempotencyKey },
          },
          body: {
            channel: 'file',
            uploadId: data.uploadId,
            declaredComplete: data.declaredComplete,
          },
        }),
      ),
    ),
  );

/** `GET /v1/commissions/{slug}/roster/imports/{importId}`: progress, mapping and counts. */
export const getRosterImport = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: commissionSlug, importId: z.uuid() }))
  .handler(({ data }): Promise<DirectoryResult<RosterImport>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.GET('/v1/commissions/{slug}/roster/imports/{importId}', {
          params: { path: { slug: data.slug, importId: data.importId } },
        }),
      ),
    ),
  );

/**
 * The tenant's import that is still running, if any: the newest imports, first one pending or
 * processing. At most one runs per tenant, and it is among the newest.
 */
export const findRunningRosterImport = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: commissionSlug }))
  .handler(({ data }): Promise<DirectoryResult<RosterImport | null>> =>
    asViewer(async (client) => {
      const page = await callDirectory(() =>
        client.GET('/v1/commissions/{slug}/roster/imports', {
          params: { path: { slug: data.slug }, query: { limit: 5 } },
        }),
      );
      if (!page.ok) return page;
      const running = page.data.items.find(importRunning);
      return { ok: true, data: running ?? null };
    }),
  );

/** `GET /v1/commissions/{slug}/roster/imports`: one page of the import history, newest first. */
export const listRosterImports = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: commissionSlug, cursor: z.string().max(500).optional() }))
  .handler(({ data }): Promise<DirectoryResult<RosterImportPage>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.GET('/v1/commissions/{slug}/roster/imports', {
          params: {
            path: { slug: data.slug },
            query: { limit: IMPORT_HISTORY_PAGE_SIZE, cursor: data.cursor },
          },
        }),
      ),
    ),
  );

/**
 * `GET /v1/commissions/{slug}/roster/imports/{importId}/rows?status=rejected`: one page of an
 * import's rejected rows, in row order. 403 for EACC (rows hold personal data), 410 once the
 * rows are purged, 30 days after the import ended.
 */
export const listRejectedRows = createServerFn({ method: 'GET' })
  .validator(
    z.object({ slug: commissionSlug, importId: z.uuid(), cursor: z.string().max(500).optional() }),
  )
  .handler(({ data }): Promise<DirectoryResult<RosterImportRowPage>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.GET('/v1/commissions/{slug}/roster/imports/{importId}/rows', {
          params: {
            path: { slug: data.slug, importId: data.importId },
            query: { status: 'rejected', limit: REJECTED_ROWS_PAGE_SIZE, cursor: data.cursor },
          },
        }),
      ),
    ),
  );
