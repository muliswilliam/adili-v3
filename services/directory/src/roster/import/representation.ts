import { z } from 'zod';

import { ROSTER_COLUMNS } from '../columns.js';
import { IMPORT_CHANNELS, IMPORT_FORMATS, IMPORT_STATES } from '../schema.js';

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
});
export type RosterImport = z.infer<typeof rosterImportSchema>;

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
