import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  Roles,
  ZodValidationPipe,
} from '@adili/api-kit';

import { STAFF_ROLES } from './access.js';
import { CommissionsService } from './commissions.service.js';
import { type CreateCommissionBody, createCommissionBody } from './create-commission.js';
import { type ListCommissionsQuery, listCommissionsQuery } from './list-query.js';
import type { Commission, CommissionPage, OfficerCategory } from './representation.js';

@ApiTags('commissions')
@ApiBearerAuth()
@Controller('v1/commissions')
@Roles(...STAFF_ROLES)
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @Post()
  @Roles('platform-admin')
  @RequireIdempotencyKey()
  @ApiOperation({
    operationId: 'createCommission',
    summary: 'Create a Responsible Commission and provision its workspace',
    description: 'platform-admin only. Idempotent per Idempotency-Key.',
  })
  @ApiCreatedResponse({ description: 'Commission created with policy version 1' })
  @ApiBadRequestResponse({ description: 'Request failed validation' })
  @ApiForbiddenResponse({ description: 'Caller lacks the required role' })
  @ApiConflictResponse({ description: 'Tenant key or name already exists' })
  @ApiUnprocessableEntityResponse({
    description: 'Idempotency-Key reused with a different request body',
  })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(createCommissionBody)) body: CreateCommissionBody,
  ): Promise<Commission> {
    return this.commissions.create(principal, body);
  }

  @Get()
  @ApiOperation({
    operationId: 'listCommissions',
    summary: 'List Responsible Commissions',
    description:
      "platform-admin, eacc-analyst and eacc-supervisor see every Commission. Other staff see only their own tenant's Commission.",
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Case-insensitive match on name or slug',
  })
  @ApiQuery({ name: 'type', required: false, enum: ['hosted', 'federated'] })
  @ApiQuery({ name: 'reportingOfficer', required: false, enum: ['none', 'invited', 'activated'] })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({ description: 'Page of Commissions ordered by name' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(listCommissionsQuery)) query: ListCommissionsQuery,
  ): Promise<CommissionPage> {
    return this.commissions.list(principal, query);
  }

  @Get(':slug')
  @ApiOperation({
    operationId: 'getCommission',
    summary: 'One Commission with its reporting officer and roster summary',
  })
  @ApiOkResponse({ description: 'The Commission' })
  @ApiNotFoundResponse({ description: 'Not found, or not visible to the caller' })
  get(@CurrentPrincipal() principal: Principal, @Param('slug') slug: string): Promise<Commission> {
    return this.commissions.get(principal, slug);
  }
}

@ApiTags('reference')
@ApiBearerAuth()
@Controller('v1/reference')
@Roles(...STAFF_ROLES)
export class ReferenceController {
  constructor(private readonly commissions: CommissionsService) {}

  @Get('officer-categories')
  @ApiOperation({
    operationId: 'listOfficerCategories',
    summary: 'Statutory categories of public officers (Act s.32, Regs r.5)',
  })
  @ApiOkResponse({ description: 'Seeded list, stable order' })
  listOfficerCategories(): Promise<OfficerCategory[]> {
    return this.commissions.listOfficerCategories();
  }
}
