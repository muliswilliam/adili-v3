import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  schemaRef,
  Scopes,
} from '@adili/api-kit';
import { DIRECTORY_INTERNAL_SCOPE } from '@adili/roles';

import { DirectoryInternalApi } from '../internal-api.js';
import { CommissionsService } from './commissions.service.js';
import type { InternalCommission, InternalCommissionList } from './representation.js';

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
  constructor(private readonly commissions: CommissionsService) {}

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
}
