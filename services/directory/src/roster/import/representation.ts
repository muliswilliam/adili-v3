import { problemDetailsSchema } from '@adili/api-kit';
import { z } from 'zod';

import { ROSTER_COLUMNS, type RosterField } from '../columns.js';
import { ROW_ERROR_CODES } from '../row-validation.js';
import {
  IMPORT_CHANNELS,
  IMPORT_FORMATS,
  IMPORT_ROW_OUTCOMES,
  IMPORT_ROW_STATUSES,
  IMPORT_STATES,
} from '../schema.js';

/**
 * Request and response shapes of the roster import endpoints (spec #27). They are the contract:
 * the OpenAPI document is generated from them.
 */

export const IMPORT_FAILURE_CODES = [
  'missing-columns',
  'upload-not-clean',
  'parse-error',
  'storage-error',
  'internal',
] as const;
export type ImportFailureCode = (typeof IMPORT_FAILURE_CODES)[number];

const columnNames = ROSTER_COLUMNS.map((column) => column.name) as [string, ...string[]];

export const importChannelSchema = z.enum(IMPORT_CHANNELS);
export const importStateSchema = z.enum(IMPORT_STATES);
export const importFailureCodeSchema = z.enum(IMPORT_FAILURE_CODES);
const rosterColumnNameSchema = z.enum(columnNames);

export const columnMappingSchema = z.object({
  matched: z
    .array(
      z.object({
        source: z.string().meta({ description: 'Header as written in the file' }),
        field: rosterColumnNameSchema.meta({ description: 'Template column it matched' }),
      }),
    )
    .meta({ description: 'File headers matched to template columns, in file order' }),
  ignored: z.array(z.string()).meta({
    description: 'File headers that match no template column, or repeat one already matched',
  }),
  missing: z
    .array(rosterColumnNameSchema)
    .meta({ description: 'Optional template columns not present' }),
});

export const importCountsSchema = z.object({
  accepted: z.number().int().meta({ description: 'Rows that passed validation when staged' }),
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  rejected: z.number().int().meta({
    description: 'Rows rejected when staged or when applied (`identity-locked`)',
  }),
  flaggedAbsent: z.number().int().meta({
    description: 'Records flagged as absent from this complete import',
  }),
  exitsRecorded: z.number().int().meta({ description: 'Exits recorded by this import' }),
});
export type ImportCounts = z.infer<typeof importCountsSchema>;

export const rosterImportSchema = z.object({
  id: z.uuid(),
  channel: importChannelSchema,
  declaredComplete: z.boolean().meta({
    description: 'The file is the complete roster: officers not in it get flagged as absent',
  }),
  state: importStateSchema,
  fileName: z.string().nullable().meta({ description: 'Name of the uploaded file' }),
  format: z.enum(IMPORT_FORMATS).nullable(),
  totalRows: z
    .number()
    .int()
    .nullable()
    .meta({ description: 'Data rows in the file; null until staging finishes' }),
  processedRows: z.number().int().meta({
    description:
      'Rows whose outcome is decided (rejected when staged, or applied); equals totalRows once completed',
  }),
  counts: importCountsSchema.nullable().meta({ description: 'Set when the import ends' }),
  mapping: columnMappingSchema.nullable().meta({
    description: 'How the file header lined up with the template; null for API batches',
  }),
  failure: z
    .object({
      code: importFailureCodeSchema,
      detail: z.string().meta({ description: 'Readable reason, e.g. the missing columns' }),
    })
    .nullable()
    .meta({ description: 'Set when the import failed' }),
  startedBy: z.object({
    kind: z.enum(['user', 'client']),
    id: z.string().meta({ description: "User's account (`sub`), or the HR system's client id" }),
    name: z
      .string()
      .nullable()
      .meta({
        description:
          'Display name when it started (the client id for HR systems); null when the token had none',
        examples: ['Fatuma Wanjiru'],
      }),
  }),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  rowsRetainedUntil: z.iso.datetime().nullable().meta({
    description:
      'When the rows (and the rejected rows report) are purged, 30 days after the import ended; null until it ends. The import itself and its counts are kept.',
  }),
});
export type RosterImport = z.infer<typeof rosterImportSchema>;

const cursorSchema = z
  .string()
  .max(500)
  .optional()
  .meta({ description: '`nextCursor` of the previous page; omit for the first page' });

/** Query of `GET /v1/commissions/{slug}/roster/imports`. */
export const listRosterImportsQuery = z.object({
  cursor: cursorSchema,
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListRosterImportsQuery = z.infer<typeof listRosterImportsQuery>;

export const rosterImportPageSchema = z.object({
  items: z.array(rosterImportSchema).meta({ description: 'Newest first' }),
  nextCursor: z
    .string()
    .nullable()
    .meta({ description: 'Pass as `cursor` for the next page; null on the last page' }),
});
export type RosterImportPage = z.infer<typeof rosterImportPageSchema>;

const fields = ROSTER_COLUMNS.map((column) => column.field) as [RosterField, ...RosterField[]];

export const rowErrorSchema = z.object({
  field: z.enum(fields).meta({ description: 'The roster field at fault' }),
  code: z.enum(ROW_ERROR_CODES),
  message: z.string().meta({ description: 'What to fix, in English' }),
});

const rawValue = z.string().nullable().optional();

export const rosterImportRowSchema = z.object({
  rowNumber: z.number().int().meta({
    description: 'Row in the file (the header is row 1), or the 1-based index in an API batch',
  }),
  status: z.enum(IMPORT_ROW_STATUSES),
  raw: z
    .object(
      Object.fromEntries(fields.map((field) => [field, rawValue])) as Record<
        RosterField,
        typeof rawValue
      >,
    )
    .meta({ description: 'The values as sent, by field; only the columns the file had' }),
  errors: z.array(rowErrorSchema).meta({ description: 'Why the row was rejected; empty if not' }),
  outcome: z.enum(IMPORT_ROW_OUTCOMES).nullable().meta({
    description:
      'What applying the row did to its record; null until applied, and for rejected rows',
  }),
  recordId: z.uuid().nullable().meta({
    description: 'The record the row applied to, or whose identity lock rejected it',
  }),
});
export type RosterImportRow = z.infer<typeof rosterImportRowSchema>;

/** Query of `GET /v1/commissions/{slug}/roster/imports/{importId}/rows`. */
export const listRosterImportRowsQuery = z.object({
  status: z
    .enum(IMPORT_ROW_STATUSES)
    .optional()
    .meta({ description: 'Only rows with this status' }),
  cursor: cursorSchema,
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListRosterImportRowsQuery = z.infer<typeof listRosterImportRowsQuery>;

export const rosterImportRowPageSchema = z.object({
  items: z.array(rosterImportRowSchema).meta({ description: 'In row-number order' }),
  nextCursor: z
    .string()
    .nullable()
    .meta({ description: 'Pass as `cursor` for the next page; null on the last page' }),
});
export type RosterImportRowPage = z.infer<typeof rosterImportRowPageSchema>;

const uploadIdSchema = z.uuid().meta({
  description: 'A clean upload with purpose roster-import (documents service)',
});

export const startFileImportBody = z.object({
  channel: z.literal('file'),
  uploadId: uploadIdSchema,
  declaredComplete: z.boolean().meta({
    description: 'True when the file is the complete roster; absent officers get flagged',
  }),
});
export type StartFileImportBody = z.infer<typeof startFileImportBody>;

/** The 409 of `startRosterImport`: problem details, naming the running import when that is why. */
export const importConflictProblemSchema = problemDetailsSchema.extend({
  importId: z.uuid().optional().meta({
    description:
      'For `import-in-progress`: the import still running, to follow with `getRosterImport`. Absent if it ended in the meantime; start again.',
  }),
});

export const previewRosterImportBody = z.object({ uploadId: uploadIdSchema });
export type PreviewRosterImportBody = z.infer<typeof previewRosterImportBody>;

export const rosterImportPreviewSchema = z.object({
  uploadId: z.uuid(),
  fileName: z.string().nullable(),
  format: z.enum(['csv', 'xlsx']),
  mapping: columnMappingSchema,
  missingRequired: z.array(rosterColumnNameSchema).meta({
    description: 'Required template columns the file lacks; the import would fail while any are',
  }),
  estimatedRows: z.number().int().nullable().meta({
    description:
      'Data rows: exact for smaller files, estimated from the file size for large CSV files, null for large XLSX files',
  }),
});
export type RosterImportPreview = z.infer<typeof rosterImportPreviewSchema>;
