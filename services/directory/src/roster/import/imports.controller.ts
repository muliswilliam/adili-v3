import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  AuditedRead,
  CurrentPrincipal,
  type Principal,
  RATE_LIMIT_HEADERS,
  RequireIdempotencyKey,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { REPORTING_OFFICER_ROLE } from '../../commissions/access.js';
import { HrSystemAccess } from '../api-credential/hr-system-access.js';
import { RECORD_READ_ROLES } from '../records/access.js';
import { RosterImportRowsService } from './import-rows.service.js';
import { RosterImportsService } from './imports.service.js';
import { StartImportValidationPipe } from './start-import.pipe.js';
import {
  type ListRosterImportRowsQuery,
  listRosterImportRowsQuery,
  type ListRosterImportsQuery,
  listRosterImportsQuery,
  type PreviewRosterImportBody,
  previewRosterImportBody,
  type RosterImport,
  type RosterImportPage,
  type RosterImportPreview,
  type RosterImportRowPage,
  type StartRosterImportBody,
} from './representation.js';

/** Roles that read a Commission's imports (spec #27 authorisation matrix). */
export const IMPORT_READ_ROLES = [
  REPORTING_OFFICER_ROLE,
  'commission-admin',
  'platform-admin',
  'eacc-analyst',
  'eacc-supervisor',
] as const;

const NOT_VISIBLE = 'Not found: another Commission, or the Commission does not exist';
const UPLOAD_PROBLEMS = {
  notFound: 'Problem type `upload-not-found`: the Commission has no roster upload with that id',
  notClean: 'Problem type `upload-not-clean`: the upload has not passed its checks',
  unavailable:
    'Problem type `documents-unavailable`: the file cannot be read right now; safe to retry',
};

const IMPORT_READERS =
  "The Commission's reporting officer, commission admin and HR system (`roster:write`); platform admin, EACC analyst and supervisor for every Commission.";

const ROWS_PURGED =
  'Problem type `import-rows-purged`: the import ended over 30 days ago and its rows were purged; its counts remain';

@ApiTags('roster')
@Controller('v1/commissions/:slug/roster/imports')
@ApiParam({ name: 'slug', schema: schemaRef('Slug') })
export class RosterImportsController {
  constructor(
    private readonly imports: RosterImportsService,
    private readonly rows: RosterImportRowsService,
  ) {}

  @Get()
  @Roles(...IMPORT_READ_ROLES)
  @HrSystemAccess('roster-read')
  @ApiOperation({
    operationId: 'listRosterImports',
    summary: 'Import history, newest first',
    description: IMPORT_READERS,
  })
  @ApiQueryParameters(listRosterImportsQuery)
  @ApiOkResponse({
    description: 'Page of imports',
    schema: schemaRef('RosterImportPage'),
    headers: RATE_LIMIT_HEADERS,
  })
  @ApiProblemResponse(400, 'Query failed validation, or the cursor is unknown')
  @ApiProblemResponse(404, NOT_VISIBLE)
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(listRosterImportsQuery)) query: ListRosterImportsQuery,
  ): Promise<RosterImportPage> {
    return this.imports.list(principal, slug, query);
  }

  @Post()
  @Roles(REPORTING_OFFICER_ROLE)
  @HrSystemAccess('roster-write')
  @RequireIdempotencyKey()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'startRosterImport',
    summary: 'Start importing a clean roster upload, or a batch of rows',
    description:
      "Reporting officer of the Commission, with an upload (`channel: file`); the Commission's HR system (`roster:write`), with up to 1,000 rows inline (`channel: api`). At most one import may be pending or processing per Commission. Returns 202 with the import `pending`; poll `getRosterImport` for progress, counts and the failure reason, and `listRosterImportRows` for rejected rows. A batch is rejected with 400 only for its shape (row count, value types); rows that break the row rules are rejected in the report, like a file's. Idempotent per Idempotency-Key.",
  })
  @ApiBody({ required: true, schema: schemaRef('StartRosterImport') })
  @ApiAcceptedResponse({
    description: 'Import accepted',
    schema: schemaRef('RosterImport'),
    headers: RATE_LIMIT_HEADERS,
  })
  @ApiProblemResponse(
    400,
    'Request failed validation; for a batch, `rowIndex` names the row of each error',
    'RosterBatchProblem',
  )
  @ApiProblemResponse(404, `${NOT_VISIBLE}. ${UPLOAD_PROBLEMS.notFound}`)
  @ApiProblemResponse(
    409,
    `Problem type \`import-in-progress\`: another import of the Commission is still running; \`importId\` names it. ${UPLOAD_PROBLEMS.notClean}`,
    'ImportConflictProblem',
  )
  @ApiProblemResponse(502, UPLOAD_PROBLEMS.unavailable)
  @ApiProblemResponse(
    503,
    'Problem type `import-unavailable`: the import could not be started and nothing was recorded; safe to retry',
  )
  start(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Body(new StartImportValidationPipe()) body: StartRosterImportBody,
  ): Promise<RosterImport> {
    return body.channel === 'api'
      ? this.imports.startBatch(principal, slug, body)
      : this.imports.startFile(principal, slug, body);
  }

  @Post('preview')
  @Roles(REPORTING_OFFICER_ROLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'previewRosterImport',
    summary: "How a clean upload's columns line up with the template, before importing",
    description:
      'Reporting officer of the Commission. Reads the header row and counts (or, for large files, estimates) the data rows. Changes nothing.',
  })
  @ApiBody({ required: true, schema: schemaRef('PreviewRosterImport') })
  @ApiOkResponse({ description: 'The preview', schema: schemaRef('RosterImportPreview') })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(404, `${NOT_VISIBLE}. ${UPLOAD_PROBLEMS.notFound}`)
  @ApiProblemResponse(409, UPLOAD_PROBLEMS.notClean)
  @ApiProblemResponse(
    422,
    'Problem type `unreadable-file`: the file is empty or not a readable CSV or XLSX; `detail` says why',
  )
  @ApiProblemResponse(502, UPLOAD_PROBLEMS.unavailable)
  preview(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(previewRosterImportBody)) body: PreviewRosterImportBody,
  ): Promise<RosterImportPreview> {
    return this.imports.preview(principal, slug, body);
  }

  @Get(':importId')
  @Roles(...IMPORT_READ_ROLES)
  @HrSystemAccess('roster-read')
  @ApiParam({ name: 'importId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'getRosterImport',
    summary: 'One import with progress, mapping, counts and failure reason',
    description: IMPORT_READERS,
  })
  @ApiOkResponse({
    description: 'The import',
    schema: schemaRef('RosterImport'),
    headers: RATE_LIMIT_HEADERS,
  })
  @ApiProblemResponse(400, 'importId is not a UUID')
  @ApiProblemResponse(404, `${NOT_VISIBLE}, or no such import`)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Param('importId', new ZodValidationPipe(z.uuid())) id: string,
  ): Promise<RosterImport> {
    return this.imports.get(principal, slug, id);
  }

  @Get(':importId/rows')
  @Roles(...RECORD_READ_ROLES)
  @HrSystemAccess('roster-read')
  @AuditedRead({ action: 'roster.import-rows.listed', resource: 'roster-import' })
  @ApiParam({ name: 'importId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'listRosterImportRows',
    summary: "An import's rows with their status, errors and outcome, by row number",
    description:
      "Read like roster records, as rows hold personal data: the Commission's reporting officer, commission admin and HR system (`roster:write`), and platform admins (audited); not EACC. Rows are kept for 30 days after the import ends (`rowsRetainedUntil`).",
  })
  @ApiQueryParameters(listRosterImportRowsQuery)
  @ApiOkResponse({
    description: 'Page of rows',
    schema: schemaRef('RosterImportRowPage'),
    headers: RATE_LIMIT_HEADERS,
  })
  @ApiProblemResponse(
    400,
    'Query failed validation, the cursor is unknown, or importId is not a UUID',
  )
  @ApiProblemResponse(404, `${NOT_VISIBLE}, or no such import`)
  @ApiProblemResponse(410, ROWS_PURGED)
  listRows(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Param('importId', new ZodValidationPipe(z.uuid())) id: string,
    @Query(new ZodValidationPipe(listRosterImportRowsQuery)) query: ListRosterImportRowsQuery,
  ): Promise<RosterImportRowPage> {
    return this.rows.list(principal, slug, id, query);
  }

  @Get(':importId/report.csv')
  @Roles(...RECORD_READ_ROLES)
  @HrSystemAccess('roster-read')
  @AuditedRead({ action: 'roster.import-report.downloaded', resource: 'roster-import' })
  @ApiParam({ name: 'importId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'getRosterImportReportCsv',
    summary: 'Rejected rows as CSV with reason columns appended',
    description:
      "Same callers as `listRosterImportRows`. One line per rejected row, in row order: the nine template columns with the values as sent, then `row_number`, `error_fields`, `error_codes` and `error_messages` (several errors joined by `; `). UTF-8 with a byte order mark; values that a spreadsheet would run as a formula are prefixed with `'`. The fixed file can be uploaded again as it is: the reason columns are ignored. Streamed, and sent as an attachment (`Content-Disposition`).",
  })
  @ApiOkResponse({
    description: 'The rejected rows',
    content: { 'text/csv': { schema: { type: 'string' } } },
    headers: RATE_LIMIT_HEADERS,
  })
  @ApiProblemResponse(400, 'importId is not a UUID')
  @ApiProblemResponse(404, `${NOT_VISIBLE}, or no such import`)
  @ApiProblemResponse(410, ROWS_PURGED)
  async report(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Param('importId', new ZodValidationPipe(z.uuid())) id: string,
  ): Promise<StreamableFile> {
    const report = await this.rows.report(principal, slug, id);
    return new StreamableFile(report.body, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${report.fileName}"`,
    });
  }
}
