import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, CurrentPrincipal, type Principal } from '@adili/api-kit';

import { TENANT_SLUG } from '../access.js';
import {
  type CommissionOpenDataPreview,
  CommissionOpenDataPreviewService,
} from './commission-preview.js';

/**
 * A Commission's own rows of the current open-data release (spec 09b S6): its commission-admin
 * only. Anyone not of the Commission, EACC included, gets 404; its other staff get 403.
 */
@ApiTags('open-data')
@Controller('v1/commissions/:slug/open-data/preview')
export class CommissionOpenDataPreviewController {
  constructor(private readonly previews: CommissionOpenDataPreviewService) {}

  @Get()
  @ApiParam({ name: 'slug', schema: { type: 'string', pattern: TENANT_SLUG.source } })
  @ApiOperation({
    operationId: 'getCommissionOpenDataPreview',
    summary:
      "The Commission's own rows of the current preview or published release, suppression as released (commission-admin)",
  })
  @ApiOkResponse({ description: 'The release and the Commission rows per table' })
  @ApiProblemResponse(403, 'Not a commission-admin of the Commission')
  @ApiProblemResponse(404, 'Not visible to the caller, or no release built yet')
  @ApiProblemResponse(503, 'Object storage could not be reached')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
  ): Promise<CommissionOpenDataPreview> {
    return this.previews.preview(principal, slug);
  }
}
