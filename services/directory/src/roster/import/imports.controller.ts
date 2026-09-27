import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
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
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { REPORTING_OFFICER_ROLE } from '../../commissions/access.js';
import { RosterImportsService } from './imports.service.js';
import {
  type PreviewRosterImportBody,
  previewRosterImportBody,
  type RosterImport,
  type RosterImportPreview,
  type StartFileImportBody,
  startFileImportBody,
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

@ApiTags('roster')
@Controller('v1/commissions/:slug/roster/imports')
@ApiParam({ name: 'slug', schema: schemaRef('Slug') })
export class RosterImportsController {
  constructor(private readonly imports: RosterImportsService) {}

  @Post()
  @Roles(REPORTING_OFFICER_ROLE)
  @RequireIdempotencyKey()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'startRosterImport',
    summary: 'Start importing a clean roster upload',
    description:
      'Reporting officer of the Commission. At most one import may be pending or processing per Commission. Returns 202 with the import `pending`; poll `getRosterImport` for progress, counts and the failure reason. Idempotent per Idempotency-Key.',
  })
  @ApiBody({ required: true, schema: schemaRef('StartFileImport') })
  @ApiAcceptedResponse({ description: 'Import accepted', schema: schemaRef('RosterImport') })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(404, `${NOT_VISIBLE}. ${UPLOAD_PROBLEMS.notFound}`)
  @ApiProblemResponse(
    409,
    `Problem type \`import-in-progress\`: another import of the Commission is still running. ${UPLOAD_PROBLEMS.notClean}`,
  )
  @ApiProblemResponse(502, UPLOAD_PROBLEMS.unavailable)
  @ApiProblemResponse(
    503,
    'Problem type `import-unavailable`: the import could not be started and nothing was recorded; safe to retry',
  )
  start(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(startFileImportBody)) body: StartFileImportBody,
  ): Promise<RosterImport> {
    return this.imports.startFile(principal, slug, body);
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
  @ApiParam({ name: 'importId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'getRosterImport',
    summary: 'One import with progress, mapping, counts and failure reason',
    description:
      "The Commission's reporting officer and commission admin; platform admin, EACC analyst and supervisor for every Commission.",
  })
  @ApiOkResponse({ description: 'The import', schema: schemaRef('RosterImport') })
  @ApiProblemResponse(400, 'importId is not a UUID')
  @ApiProblemResponse(404, `${NOT_VISIBLE}, or no such import`)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Param('importId', new ZodValidationPipe(z.uuid())) id: string,
  ): Promise<RosterImport> {
    return this.imports.get(principal, slug, id);
  }
}
