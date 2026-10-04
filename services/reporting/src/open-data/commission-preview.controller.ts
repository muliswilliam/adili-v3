import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, CurrentPrincipal, type Principal, schemaRef } from '@adili/api-kit';

import { TENANT_SLUG } from '../access.js';
import {
  type CommissionOpenDataPreview,
  CommissionOpenDataPreviewService,
} from './commission-preview.service.js';

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
    description:
      "The release shown is, of the most recent financial year with a preview or published release, the one built last; withdrawn releases are never shown. Only the Commission tables, filtered to the caller's Commission; national tables and other Commissions' rows are never returned. Anyone not of the Commission gets 404, its other staff 403.",
  })
  @ApiOkResponse({
    description: "The release and the Commission's rows per table",
    schema: schemaRef('CommissionOpenDataPreview'),
  })
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
