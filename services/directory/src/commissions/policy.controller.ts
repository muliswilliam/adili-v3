import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';

import { DirectoryInternalApi } from '../internal-api.js';
import { STAFF_ROLES } from './access.js';
import {
  type CreateTenantPolicyVersionBody,
  createTenantPolicyVersionBody,
  type TenantPolicyHistory,
  type TenantPolicyVersion,
} from './policy-representation.js';
import { PolicyService } from './policy.service.js';

/** The `slug` path parameter, documented as the contract's `Slug`. */
const ApiSlugParam = () => ApiParam({ name: 'slug', schema: schemaRef('Slug') });

const NOT_VISIBLE = 'Not found, or not visible to the caller';

@ApiTags('policy')
@Controller('v1/commissions/:slug/policy')
@ApiSlugParam()
export class PolicyController {
  constructor(private readonly policy: PolicyService) {}

  @Get()
  @Roles(...STAFF_ROLES)
  @ApiOperation({
    operationId: 'getTenantPolicy',
    summary: 'Current policy version and history for a Commission',
    description:
      "Staff of the Commission; platform-admin, eacc-analyst and eacc-supervisor for every Commission. The console's policy card reads it.",
  })
  @ApiOkResponse({
    description: 'Current version and previous versions',
    schema: schemaRef('TenantPolicyHistory'),
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  history(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
  ): Promise<TenantPolicyHistory> {
    return this.policy.history(principal, slug);
  }

  @Post('versions')
  @Roles('commission-admin', 'platform-admin')
  @RequireIdempotencyKey()
  @ApiOperation({
    operationId: 'createTenantPolicyVersion',
    summary: 'Create a new policy version (only obligationsStartDate is editable in this slice)',
    description:
      'The commission-admin of the tenant, or a platform-admin. Other fields are copied from the current version; the new one is in force from now and `directory.policy.changed.v1` announces it. Idempotent per Idempotency-Key.',
  })
  @ApiBody({ required: true, schema: schemaRef('CreateTenantPolicyVersion') })
  @ApiCreatedResponse({
    description: 'New version in force',
    schema: schemaRef('TenantPolicyVersion'),
  })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(404, "Not found, or another Commission's")
  createVersion(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(createTenantPolicyVersionBody)) body: CreateTenantPolicyVersionBody,
  ): Promise<TenantPolicyVersion> {
    return this.policy.createVersion(principal, slug, body);
  }
}

@ApiTags('internal')
@Controller('internal/v1/commissions/:slug/policy')
@ApiSlugParam()
@DirectoryInternalApi()
export class InternalPolicyController {
  constructor(private readonly policy: PolicyService) {}

  @Get()
  @ApiOperation({
    operationId: 'internalGetTenantPolicy',
    summary: 'Current policy version for a Commission (services)',
    description:
      'Service tokens with scope directory:internal, acting for the Commission in X-Acting-Tenant. Pull it again on `directory.policy.changed.v1`.',
  })
  @ApiOkResponse({ description: 'Current version', schema: schemaRef('TenantPolicyVersion') })
  @ApiProblemResponse(404, 'Not found, or not the acting tenant')
  current(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('slug') slug: string,
  ): Promise<TenantPolicyVersion> {
    return this.policy.current(principal, tenant, slug);
  }
}
