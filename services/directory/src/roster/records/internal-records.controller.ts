import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
  ApiQueryParameters,
  AuditedRead,
  CurrentPrincipal,
  type Principal,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { DirectoryInternalApi } from '../../internal-api.js';
import {
  type InternalListRosterRecordsQuery,
  internalListRosterRecordsQuery,
} from './internal-query.js';
import { InternalRosterRecordsService } from './internal-records.service.js';
import type { InternalRosterRecord, InternalRosterRecordPage } from './representation.js';

const CALLERS =
  'Service tokens with scope directory:internal, acting for the Commission in X-Acting-Tenant; audited.';

/** Internal: not routed by the public entrypoint. Callers are services pulling after an event. */
@ApiTags('internal')
@Controller('internal/v1/commissions/:slug/roster/records')
@ApiParam({ name: 'slug', schema: schemaRef('Slug') })
@DirectoryInternalApi()
export class InternalRosterRecordsController {
  constructor(private readonly records: InternalRosterRecordsService) {}

  @Get()
  @AuditedRead({ action: 'roster.records.pulled', resource: 'roster-record' })
  @ApiOperation({
    operationId: 'internalListRosterRecords',
    summary: 'Roster records touched by an import or an exit batch (services)',
    description: `${CALLERS} Exactly one of importId and exitBatchId. Each record as it is now, up to 1,000 per page.`,
  })
  @ApiQueryParameters(internalListRosterRecordsQuery)
  @ApiOkResponse({
    description: 'Page of records',
    schema: schemaRef('InternalRosterRecordPage'),
  })
  @ApiProblemResponse(
    400,
    'Query failed validation: not exactly one of importId and exitBatchId, or an unknown cursor',
  )
  @ApiProblemResponse(404, "No such import or exit batch of the acting tenant's Commission")
  list(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(internalListRosterRecordsQuery))
    query: InternalListRosterRecordsQuery,
  ): Promise<InternalRosterRecordPage> {
    return this.records.list(principal, tenant, slug, query);
  }

  @Get(':recordId')
  @AuditedRead({ action: 'roster.record.pulled', resource: 'roster-record' })
  @ApiParam({ name: 'recordId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'internalGetRosterRecord',
    summary: 'One roster record (services)',
    description: `${CALLERS} E.g. after \`declarant.onboarded.v1\`.`,
  })
  @ApiOkResponse({ description: 'The record', schema: schemaRef('InternalRosterRecord') })
  @ApiProblemResponse(400, 'recordId is not a UUID')
  @ApiProblemResponse(404, "No such record in the acting tenant's Commission")
  get(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('slug') slug: string,
    @Param('recordId', new ZodValidationPipe(z.uuid())) recordId: string,
  ): Promise<InternalRosterRecord> {
    return this.records.get(principal, tenant, slug, recordId);
  }
}
