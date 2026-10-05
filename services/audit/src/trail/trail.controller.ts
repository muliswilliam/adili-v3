import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  AuditedRead,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { AUDITOR } from '@adili/roles';
import { z } from 'zod';

import {
  type AuditEventDetail,
  type AuditEventPage,
  type ChainPage,
  type ListChainsQuery,
  listChainsQuery,
  type ListEventsQuery,
  listEventsQuery,
} from './representation.js';
import { TrailQueryService } from './trail-query.service.js';
import { type ChainVerification, ChainVerifier } from './verifier.js';

/**
 * The audit trail for auditors (ADR-008, architecture §7 roles: the auditor investigates the
 * audit trail across the platform and changes nothing). Every route is itself an audited read.
 */
@ApiTags('audit')
@Controller('v1/audit')
@Roles(AUDITOR)
export class TrailController {
  constructor(
    private readonly queries: TrailQueryService,
    private readonly verifier: ChainVerifier,
  ) {}

  @Get('events')
  @AuditedRead({ action: 'audit.events.searched', resource: 'audit-event' })
  @ApiOperation({
    operationId: 'listAuditEvents',
    summary: 'Search the audit trail, newest first',
    description:
      "Every tenant's events (auditor only): reads of sensitive data, writes (each domain event), public verify lookups and sign-in facts, filtered by tenant, actor, the person the data is about, resource, action and time. The search is itself audited.",
  })
  @ApiQueryParameters(listEventsQuery)
  @ApiOkResponse({ description: 'A page of events', schema: schemaRef('AuditEventPage') })
  @ApiProblemResponse(400, 'Query failed validation, or the cursor is unknown')
  list(
    @Query(new ZodValidationPipe(listEventsQuery)) query: ListEventsQuery,
  ): Promise<AuditEventPage> {
    return this.queries.list(query);
  }

  @Get('events/:eventId')
  @AuditedRead({ action: 'audit.event.viewed', resource: 'audit-event' })
  @ApiParam({ name: 'eventId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'getAuditEvent',
    summary: 'One audit event with its data and place in its chain',
    description: 'Auditor only. The read is itself audited.',
  })
  @ApiOkResponse({ description: 'The event', schema: schemaRef('AuditEvent') })
  @ApiProblemResponse(404, 'No such event')
  get(
    @Param('eventId', new ZodValidationPipe(z.uuid())) eventId: string,
  ): Promise<AuditEventDetail> {
    return this.queries.get(eventId);
  }

  @Get('chains')
  @AuditedRead({ action: 'audit.chains.listed', resource: 'audit-chain' })
  @ApiOperation({
    operationId: 'listAuditChains',
    summary: 'The hash chains per tenant per day, with their anchors',
    description:
      "Auditor only, newest day first. A day's chain is anchored (signed Merkle root archived in object storage) once the day has ended and the daily anchoring ran.",
  })
  @ApiQueryParameters(listChainsQuery)
  @ApiOkResponse({ description: 'The chains', schema: schemaRef('AuditChainPage') })
  @ApiProblemResponse(400, 'Query failed validation')
  chains(
    @Query(new ZodValidationPipe(listChainsQuery)) query: ListChainsQuery,
  ): Promise<ChainPage> {
    return this.queries.chains(query);
  }

  @Get('chains/:tenant/:chainDay/verification')
  @AuditedRead({ action: 'audit.chain.verified', resource: 'audit-chain' })
  @ApiParam({ name: 'tenant', schema: { type: 'string', pattern: '^[a-z][a-z0-9]{1,19}$' } })
  @ApiParam({ name: 'chainDay', schema: { type: 'string', format: 'date' } })
  @ApiOperation({
    operationId: 'verifyAuditChain',
    summary: 'Recompute a chain and compare it with its anchor',
    description:
      "Auditor only. Every event in order, each linked to the one before, each hash recomputed from the event and its place, each filtered field read again from the event, the head and, once anchored, the anchor's Merkle root: any difference is reported as tampering. A day without events is intact and empty.",
  })
  @ApiOkResponse({ description: 'The verification', schema: schemaRef('AuditChainVerification') })
  @ApiProblemResponse(400, 'Tenant or day malformed')
  verify(
    @Param('tenant', new ZodValidationPipe(z.string().regex(/^[a-z][a-z0-9]{1,19}$/)))
    tenant: string,
    @Param('chainDay', new ZodValidationPipe(z.iso.date())) chainDay: string,
  ): Promise<ChainVerification> {
    return this.verifier.verify(tenant, chainDay);
  }
}
