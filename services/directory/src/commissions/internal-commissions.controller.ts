import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
  ApiQueryParameters,
  AuditedRead,
  CurrentPrincipal,
  CurrentReadAudit,
  type Principal,
  type ReadAudit,
  schemaRef,
  Scopes,
  ZodValidationPipe,
} from '@adili/api-kit';
import { DIRECTORY_INTERNAL_SCOPE } from '@adili/roles';

import { DirectoryInternalApi } from '../internal-api.js';
import { CommissionStaffService } from './commission-staff.service.js';
import { CommissionsService } from './commissions.service.js';
import {
  type InternalCommission,
  type InternalCommissionList,
  type InternalCommissionStaff,
  type StaffQuery,
  staffQuery,
} from './representation.js';

/**
 * Internal: every Commission's reference. Platform-wide public facts (slug, issuer code, name), so
 * the scope alone admits the call: there is no tenant to act for.
 */
@ApiTags('internal')
@Controller('internal/v1/commissions')
@Scopes(DIRECTORY_INTERNAL_SCOPE)
export class InternalCommissionListController {
  constructor(private readonly commissions: CommissionsService) {}

  @Get()
  @ApiOperation({
    operationId: 'internalListCommissions',
    summary: 'Slug, issuer code and name of every Commission (services)',
    description:
      'Service tokens with scope directory:internal; no X-Acting-Tenant (platform reference data, no personal data). E.g. declarations lists Commissions without a roster yet in the national obligations summary.',
  })
  @ApiOkResponse({
    description: 'Every Commission, by slug',
    schema: schemaRef('InternalCommissionList'),
  })
  async list(): Promise<InternalCommissionList> {
    return { items: await this.commissions.internalRefs() };
  }
}

/** Internal: not routed by the public entrypoint. Services keep the reference in a read model. */
@ApiTags('internal')
@Controller('internal/v1/commissions/:slug')
@ApiParam({ name: 'slug', schema: schemaRef('Slug') })
@DirectoryInternalApi()
export class InternalCommissionsController {
  constructor(
    private readonly commissions: CommissionsService,
    private readonly staffService: CommissionStaffService,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'internalGetCommission',
    summary: 'Slug, issuer code and name of a Commission (services)',
    description:
      'Service tokens with scope directory:internal, acting for the Commission in X-Acting-Tenant. E.g. declarations names the Commission of each obligation.',
  })
  @ApiOkResponse({ description: 'The Commission', schema: schemaRef('InternalCommission') })
  @ApiProblemResponse(404, 'Not found, or not the acting tenant')
  get(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('slug') slug: string,
  ): Promise<InternalCommission> {
    return this.commissions.internalRef(principal, tenant, slug);
  }

  @Get('staff')
  @AuditedRead({ action: 'commission.staff.pulled', resource: 'staff-account' })
  @ApiQueryParameters(staffQuery)
  @ApiOperation({
    operationId: 'internalListCommissionStaff',
    summary: "A Commission's staff holding a role, with their emails (services)",
    description:
      'Service tokens with scope directory:internal, acting for the Commission in X-Acting-Tenant; audited, naming the accounts read (it gives staff and their emails). Only enabled accounts with a verified email. The reporting service reminds supervisors and commission admins of the Form M deadlines, and chases reporting officers about a late report (spec 09); the access service reminds access officers of the requests awaiting them (spec 10).',
  })
  @ApiOkResponse({
    description: 'The staff holding the role',
    schema: schemaRef('InternalStaffList'),
  })
  @ApiProblemResponse(400, 'role is not reporting-officer, supervisor or commission-admin')
  @ApiProblemResponse(404, 'Not found, or not the acting tenant')
  async staff(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(staffQuery)) query: StaffQuery,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<InternalCommissionStaff> {
    const staff = await this.staffService.withRole(principal, tenant, slug, query.role);
    audit.resource({ tenant: slug, ids: staff.items.map((member) => member.subject) });
    return staff;
  }
}
