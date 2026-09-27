import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  AuditedRead,
  CurrentPrincipal,
  type Principal,
  Roles,
  Scopes,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import type { RosterSummary } from '../../commissions/representation.js';
import { ROSTER_WRITE_SCOPE } from '../api-credential/representation.js';
import { IMPORT_READ_ROLES } from '../import/imports.controller.js';
import { RECORD_READ_ROLES } from './access.js';
import { type ListRosterRecordsQuery, listRosterRecordsQuery } from './list-query.js';
import { RosterRecordsService } from './records.service.js';
import type { RosterRecord, RosterRecordPage } from './representation.js';

const NOT_VISIBLE = 'Not found: another Commission, or the Commission does not exist';
const RECORD_READERS =
  "The Commission's reporting officer and commission admin; platform admins for every Commission, audited. EACC may not read records (403).";

@ApiTags('roster')
@Controller('v1/commissions/:slug/roster')
@ApiParam({ name: 'slug', schema: schemaRef('Slug') })
export class RosterRecordsController {
  constructor(private readonly records: RosterRecordsService) {}

  @Get('summary')
  @Roles(...IMPORT_READ_ROLES)
  @Scopes(ROSTER_WRITE_SCOPE)
  @ApiOperation({
    operationId: 'getRosterSummary',
    summary: 'Expected, onboarded and flagged counts and the last import',
    description:
      "The Commission's reporting officer, commission admin and HR system (`roster:write`); platform admin, EACC analyst and supervisor for every Commission. The same summary as the Commission's `roster`.",
  })
  @ApiOkResponse({ description: 'The summary', schema: schemaRef('RosterSummary') })
  @ApiProblemResponse(404, NOT_VISIBLE)
  summary(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
  ): Promise<RosterSummary> {
    return this.records.summary(principal, slug);
  }

  @Get('records')
  @Roles(...RECORD_READ_ROLES)
  @AuditedRead({ action: 'roster.records.listed', resource: 'roster-record' })
  @ApiOperation({
    operationId: 'listRosterRecords',
    summary: 'Roster records with masked national IDs',
    description: `${RECORD_READERS} Ordered by full name. A search matches the beginning of a personnel file number, part of a full name, or a whole national ID.`,
  })
  @ApiQueryParameters(listRosterRecordsQuery)
  @ApiOkResponse({ description: 'One page of records', schema: schemaRef('RosterRecordPage') })
  @ApiProblemResponse(400, 'Query failed validation, or the cursor is unknown')
  @ApiProblemResponse(404, NOT_VISIBLE)
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(listRosterRecordsQuery)) query: ListRosterRecordsQuery,
  ): Promise<RosterRecordPage> {
    return this.records.list(principal, slug, query);
  }

  @Get('records/:recordId')
  @Roles(...RECORD_READ_ROLES)
  @AuditedRead({ action: 'roster.record.viewed', resource: 'roster-record' })
  @ApiParam({ name: 'recordId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'getRosterRecord',
    summary: 'One roster record in full, with its import history',
    description: `${RECORD_READERS} The national ID in full.`,
  })
  @ApiOkResponse({ description: 'The record', schema: schemaRef('RosterRecord') })
  @ApiProblemResponse(400, 'recordId is not a UUID')
  @ApiProblemResponse(404, `${NOT_VISIBLE}, or no such record in it`)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Param('recordId', new ZodValidationPipe(z.uuid())) recordId: string,
  ): Promise<RosterRecord> {
    return this.records.get(principal, slug, recordId);
  }
}
