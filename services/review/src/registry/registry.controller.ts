import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  AcceptIdempotencyKey,
  ApiProblemResponse,
  AuditedRead,
  CurrentPrincipal,
  type Principal,
  schemaRef,
} from '@adili/api-kit';

import { RecheckService } from './recheck.service.js';
import type { RegistryView } from './representation.js';
import { RegistryViewService } from './registry-view.service.js';

/** The registry cross-checks of a case (spec 07b): the Registry tab, and a re-check. */
@ApiTags('cases')
@Controller('v1/review/cases/:caseId')
export class RegistryController {
  constructor(
    private readonly registry: RegistryViewService,
    private readonly rechecks: RecheckService,
  ) {}

  @Get('registry')
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

  @Post('recheck')
  @AcceptIdempotencyKey()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiParam({ name: 'caseId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'recheckCaseRegistries',
    summary: 'Re-run registry lookups and matching for the case (assignee or supervisor)',
    description:
      "The case's assignee or a supervisor of its Commission; another reviewer gets 403 `not-the-assignee`, anyone else 404. Starts the registry check of the case's current version and records review.case.rechecked.v1; review.registry.checked.v1 follows once the check is stored. Flags it no longer raises are closed `superseded-by-recheck` (reviewed ones keep their note). Once per case every 10 minutes: 429 `recheck-cooldown` with `retryAfterSeconds`.",
  })
  @ApiAcceptedResponse({ description: 'Re-check started' })
  @ApiProblemResponse(403, 'Problem type `not-the-assignee`: neither the assignee nor a supervisor')
  @ApiProblemResponse(404, 'Not found, or not visible to the caller')
  @ApiProblemResponse(409, 'Problem type `case-closed`: the case is determined')
  @ApiProblemResponse(429, 'Problem type `recheck-cooldown`: re-checked within the last 10 minutes')
  recheck(
    @CurrentPrincipal() principal: Principal,
    @Param('caseId') caseId: string,
  ): Promise<void> {
    return this.rechecks.recheck(principal, caseId);
  }
}
