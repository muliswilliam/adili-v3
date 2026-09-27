import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';

import { STAFF_ROLES } from './access.js';
import {
  type AssignReportingOfficerBody,
  assignReportingOfficerBody,
} from './assign-reporting-officer.js';
import { CommissionsService } from './commissions.service.js';
import { type CreateCommissionBody, createCommissionBody } from './create-commission.js';
import { type ListCommissionsQuery, listCommissionsQuery } from './list-query.js';
import { ReportingOfficersService } from './reporting-officers.service.js';
import type { Commission, CommissionPage, OfficerCategory } from './representation.js';

/** The `slug` path parameter, documented as the contract's `Slug`. */
const ApiSlugParam = () => ApiParam({ name: 'slug', schema: schemaRef('Slug') });

@ApiTags('commissions')
@Controller('v1/commissions')
@Roles(...STAFF_ROLES)
export class CommissionsController {
  constructor(
    private readonly commissions: CommissionsService,
    private readonly reportingOfficers: ReportingOfficersService,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'listCommissions',
    summary: 'List Responsible Commissions',
    description:
      "platform-admin, eacc-analyst and eacc-supervisor see every Commission. Other staff see only their own tenant's Commission.",
  })
  @ApiQueryParameters(listCommissionsQuery)
  @ApiOkResponse({
    description: 'Page of Commissions ordered by name',
    schema: schemaRef('CommissionPage'),
  })
  @ApiProblemResponse(400, 'Query failed validation, or the cursor is unknown')
  list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(listCommissionsQuery)) query: ListCommissionsQuery,
  ): Promise<CommissionPage> {
    return this.commissions.list(principal, query);
  }

  @Post()
  @Roles('platform-admin')
  @RequireIdempotencyKey()
  @ApiOperation({
    operationId: 'createCommission',
    summary: 'Create a Responsible Commission and provision its workspace',
    description: 'platform-admin only. Idempotent per Idempotency-Key.',
  })
  @ApiBody({ required: true, schema: schemaRef('CreateCommission') })
  @ApiCreatedResponse({
    description: 'Commission created with policy version 1',
    schema: schemaRef('Commission'),
  })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(
    409,
    'Problem type `commission-exists`: the tenant key or name is taken; `errors[].path` names `slug` and/or `name`.',
  )
  create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(createCommissionBody)) body: CreateCommissionBody,
  ): Promise<Commission> {
    return this.commissions.create(principal, body);
  }

  @Get(':slug')
  @ApiSlugParam()
  @ApiOperation({
    operationId: 'getCommission',
    summary: 'One Commission with its reporting officer and roster summary',
    description:
      "platform-admin, eacc-analyst and eacc-supervisor read any Commission; other staff only their own tenant's. Answers 404 for Commissions the caller may not see.",
  })
  @ApiOkResponse({ description: 'The Commission', schema: schemaRef('Commission') })
  @ApiProblemResponse(404, 'Not found, or not visible to the caller')
  get(@CurrentPrincipal() principal: Principal, @Param('slug') slug: string): Promise<Commission> {
    return this.commissions.get(principal, slug);
  }

  @Put(':slug/reporting-officer')
  @ApiSlugParam()
  @Roles('platform-admin')
  @RequireIdempotencyKey()
  @ApiOperation({
    operationId: 'assignReportingOfficer',
    summary: "Assign or replace the Commission's reporting officer",
    description:
      'platform-admin only. Creates (or reuses, same tenant) the Keycloak staff account, grants the reporting-officer role (enabling the account if it was disabled) and sends exactly one activation email. If a current (not replaced) assignment exists it is marked `replaced` with `replacedBy` set to the new assignment, and the previous account loses the reporting-officer role (and is disabled when it holds no other role). Idempotent per Idempotency-Key.',
  })
  @ApiBody({ required: true, schema: schemaRef('AssignReportingOfficer') })
  @ApiOkResponse({
    description: 'Commission with the new assignment in state `invited`',
    schema: schemaRef('Commission'),
  })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(404, 'Commission not found')
  @ApiProblemResponse(
    409,
    'Problem type `email-belongs-to-other-tenant` with `errors[0].path = email`: the email belongs to an account in another tenant (or in none). Nothing changed and the current officer keeps access.',
  )
  @ApiProblemResponse(
    502,
    'Problem type `identity-unavailable`: the identity provider failed, nothing was assigned and identity changes already made were undone, so the current officer keeps access. Safe to retry with the same Idempotency-Key.',
  )
  assignReportingOfficer(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(assignReportingOfficerBody)) body: AssignReportingOfficerBody,
  ): Promise<Commission> {
    return this.reportingOfficers.assign(principal, slug, body);
  }

  @Post(':slug/reporting-officer/resend-invitation')
  @ApiSlugParam()
  @Roles('platform-admin')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'resendReportingOfficerInvitation',
    summary: 'Send the activation email again',
    description:
      'platform-admin only. Allowed while the current assignment is `invited`; Keycloak sends a new activation link valid for 72 hours. No Idempotency-Key: a repeated request only sends another email.',
  })
  @ApiAcceptedResponse({ description: 'Email requested' })
  @ApiProblemResponse(
    404,
    'Commission not found, or problem type `reporting-officer-not-assigned`: it has no reporting officer.',
  )
  @ApiProblemResponse(
    409,
    "Problem type `reporting-officer-activated`: the officer has already activated, so there is nothing to resend. Problem type `reporting-officer-account-missing`: the officer's account no longer exists in the identity provider; replace the officer.",
  )
  @ApiProblemResponse(
    502,
    'Problem type `identity-unavailable`: the identity provider failed, no email was sent. Safe to retry.',
  )
  resendReportingOfficerInvitation(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
  ): Promise<void> {
    return this.reportingOfficers.resendInvitation(principal, slug);
  }
}

@ApiTags('reference')
@Controller('v1/reference')
@Roles(...STAFF_ROLES)
export class ReferenceController {
  constructor(private readonly commissions: CommissionsService) {}

  @Get('officer-categories')
  @ApiOperation({
    operationId: 'listOfficerCategories',
    summary: 'Statutory categories of public officers (Act s.32, Regs r.5)',
    description: 'Any staff role. Reference data for the create form, in statutory order.',
  })
  @ApiOkResponse({
    description: 'Seeded list, stable order',
    schema: { type: 'array', items: schemaRef('OfficerCategory') },
  })
  listOfficerCategories(): Promise<OfficerCategory[]> {
    return this.commissions.listOfficerCategories();
  }
}
