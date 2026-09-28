import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, CurrentPrincipal, type Principal } from '@adili/api-kit';

import { ObligationsService } from './obligations.service.js';
import type { MyObligations, ObligationDetail } from './representation.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';

@ApiTags('obligations')
@Controller('v1')
export class ObligationsController {
  constructor(private readonly obligations: ObligationsService) {}

  @Get('me/obligations')
  @ApiOperation({
    operationId: 'getMyObligations',
    summary: "The signed-in declarant's obligations across Commissions",
    description: 'Authorised by the person_id claim. Staff tokens without it get 404.',
  })
  @ApiOkResponse({ description: 'Obligations grouped by Commission' })
  @ApiProblemResponse(404, NOT_VISIBLE)
  mine(@CurrentPrincipal() principal: Principal): Promise<MyObligations> {
    return this.obligations.mine(principal);
  }

  @Get('obligations/:id')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'getObligation',
    summary: 'One obligation with its reminder history',
    description:
      "The declarant's own (officer null); staff of the obligation's Commission and platform admins (with the officer). Anyone else gets 404.",
  })
  @ApiOkResponse({ description: 'The obligation' })
  @ApiProblemResponse(404, NOT_VISIBLE)
  one(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
  ): Promise<ObligationDetail> {
    return this.obligations.one(principal, id);
  }
}
