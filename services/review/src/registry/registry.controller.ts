import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  AuditedRead,
  CurrentPrincipal,
  type Principal,
  schemaRef,
} from '@adili/api-kit';

import type { RegistryView } from './representation.js';
import { RegistryViewService } from './registry-view.service.js';

/** The registry cross-checks of a case (spec 07b): the Registry tab. */
@ApiTags('cases')
@Controller('v1/review/cases/:caseId/registry')
export class RegistryController {
  constructor(private readonly registry: RegistryViewService) {}

  @Get()
  @AuditedRead({ action: 'review.case.registry.viewed', resource: 'review-case' })
  @ApiParam({ name: 'caseId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'getCaseRegistryChecks',
    summary:
      'Per-person, per-system registry status with records pulled from the gateway and paired with declared items',
    description:
      "Reviewers and supervisors of the case's Commission; anyone else gets 404. The records are read from the integration-gateway by result id for every call and never stored by review; the declaration is read from declarations, audited there as the caller's read for the case.",
  })
  @ApiOkResponse({ description: 'Registry view', schema: schemaRef('RegistryView') })
  @ApiProblemResponse(404, 'Not found, or not visible to the caller')
  @ApiProblemResponse(502, 'Declarations or the integration-gateway unavailable')
  view(
    @CurrentPrincipal() principal: Principal,
    @Param('caseId') caseId: string,
  ): Promise<RegistryView> {
    return this.registry.view(principal, caseId);
  }
}
