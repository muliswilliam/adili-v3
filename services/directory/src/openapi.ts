import { principalSchema } from '@adili/api-kit';
import type { z } from 'zod';

import { assignReportingOfficerBody } from './commissions/assign-reporting-officer.js';
import {
  commissionTypeSchema,
  createCommissionBody,
  officerCategoryCodeSchema,
  slugSchema,
} from './commissions/create-commission.js';
import {
  commissionPageSchema,
  commissionSchema,
  officerCategorySchema,
  reportingOfficerSchema,
  reportingOfficerStateSchema,
  rosterSummarySchema,
} from './commissions/representation.js';
import {
  confirmExitsBody,
  exitsResultSchema,
  keepResultSchema,
  keepRosterRecordsBody,
  recordRosterExitBody,
} from './roster/exits/representation.js';
import {
  columnMappingSchema,
  importChannelSchema,
  importCountsSchema,
  importConflictProblemSchema,
  importFailureCodeSchema,
  importStateSchema,
  previewRosterImportBody,
  rosterImportPageSchema,
  rosterImportPreviewSchema,
  rosterImportRowPageSchema,
  rosterImportRowSchema,
  rosterImportSchema,
  rosterBatchProblemSchema,
  rosterRowInputSchema,
  rowErrorSchema,
  startBatchImportBody,
  startFileImportBody,
  startRosterImportBody,
} from './roster/import/representation.js';
import {
  reportingEntityRefSchema,
  rosterRecordImportSchema,
  rosterRecordListItemSchema,
  rosterRecordPageSchema,
  rosterRecordSchema,
  rosterRecordStateSchema,
} from './roster/records/representation.js';
import {
  rosterApiCredentialSchema,
  rosterApiCredentialWithSecretSchema,
} from './roster/api-credential/representation.js';

/**
 * Named schemas of the directory's OpenAPI document (`#/components/schemas/<name>`), which is
 * exported to packages/schemas/internal/directory.yaml by `pnpm contracts`.
 */
export const OPENAPI_SCHEMAS: Record<string, z.ZodType> = {
  Principal: principalSchema,
  Slug: slugSchema,
  CommissionType: commissionTypeSchema,
  OfficerCategoryCode: officerCategoryCodeSchema,
  OfficerCategory: officerCategorySchema,
  CreateCommission: createCommissionBody,
  AssignReportingOfficer: assignReportingOfficerBody,
  ReportingOfficerState: reportingOfficerStateSchema,
  ReportingOfficer: reportingOfficerSchema,
  RosterSummary: rosterSummarySchema,
  Commission: commissionSchema,
  CommissionPage: commissionPageSchema,
  RosterApiCredential: rosterApiCredentialSchema,
  RosterApiCredentialWithSecret: rosterApiCredentialWithSecretSchema,
  ImportChannel: importChannelSchema,
  ImportState: importStateSchema,
  ImportFailureCode: importFailureCodeSchema,
  ColumnMapping: columnMappingSchema,
  ImportCounts: importCountsSchema,
  RosterImport: rosterImportSchema,
  StartFileImport: startFileImportBody,
  RosterRowInput: rosterRowInputSchema,
  StartBatchImport: startBatchImportBody,
  StartRosterImport: startRosterImportBody,
  RosterBatchProblem: rosterBatchProblemSchema,
  ImportConflictProblem: importConflictProblemSchema,
  PreviewRosterImport: previewRosterImportBody,
  RosterImportPreview: rosterImportPreviewSchema,
  RosterImportPage: rosterImportPageSchema,
  RowError: rowErrorSchema,
  RosterImportRow: rosterImportRowSchema,
  RosterImportRowPage: rosterImportRowPageSchema,
  RosterRecordState: rosterRecordStateSchema,
  ReportingEntityRef: reportingEntityRefSchema,
  RosterRecordListItem: rosterRecordListItemSchema,
  RosterRecordImport: rosterRecordImportSchema,
  RosterRecord: rosterRecordSchema,
  RosterRecordPage: rosterRecordPageSchema,
  ConfirmExits: confirmExitsBody,
  ExitsResult: exitsResultSchema,
  KeepRosterRecords: keepRosterRecordsBody,
  KeepResult: keepResultSchema,
  RecordRosterExit: recordRosterExitBody,
};
