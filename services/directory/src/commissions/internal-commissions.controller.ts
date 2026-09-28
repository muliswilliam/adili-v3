import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  schemaRef,
} from '@adili/api-kit';

import { DirectoryInternalApi } from '../internal-api.js';
import { CommissionsService } from './commissions.service.js';
import type { InternalCommission } from './representation.js';

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
