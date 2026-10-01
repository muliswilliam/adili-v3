import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, CurrentPrincipal, type Principal, schemaRef } from '@adili/api-kit';

import { CompareService } from './compare.service.js';
import type { VersionComparison } from './comparison.js';

@ApiTags('cases')
@Controller('v1/review/cases/:caseId/compare')
export class CompareController {
  constructor(private readonly comparisons: CompareService) {}

  @Get()
  @ApiParam({ name: 'caseId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'compareCaseVersions',
    summary: 'Item matching and deltas between the current and previous submitted version',
    description:
      "Reviewers and supervisors of the case's Commission; anyone else gets 404. Both versions are read from declarations for every call, audited there as the caller's reads for the case.",
  })
  @ApiOkResponse({ description: 'Comparison', schema: schemaRef('VersionComparison') })
  @ApiProblemResponse(404, 'Not found, or not visible to the caller')
  @ApiProblemResponse(409, 'No previous version to compare with')
  @ApiProblemResponse(502, 'Declarations service unavailable')
  compare(
    @CurrentPrincipal() principal: Principal,
    @Param('caseId') caseId: string,
  ): Promise<VersionComparison> {
    return this.comparisons.compare(principal, caseId);
  }
}
