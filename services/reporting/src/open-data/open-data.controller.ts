import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { FIRST_FINANCIAL_YEAR } from '../financial-year.js';
import { OpenDataService } from './open-data.service.js';
import type { OpenDataReleaseView } from './representation.js';

/** reporting.yaml `buildOpenDataSnapshot` body: the financial year (start year). */
const snapshotBody = z.strictObject({ fy: z.number().int().min(FIRST_FINANCIAL_YEAR) });
type SnapshotBody = z.infer<typeof snapshotBody>;

/** reporting.yaml `withdrawOpenDataRelease` body: the public reason. */
const withdrawBody = z.strictObject({ reason: z.string().trim().min(1).max(1000) });
type WithdrawBody = z.infer<typeof withdrawBody>;

const ApiReleaseIdParam = () =>
  ApiParam({ name: 'releaseId', schema: { type: 'string', format: 'uuid' } });

const SUPERVISOR_ONLY = 'Only an EACC supervisor';

const EACC_ONLY = 'Only EACC analysts and supervisors';

/**
 * EACC's open-data releases (spec 09b): the list, previews and withdrawn included, and building a
 * mid-year snapshot as a preview (EACC analysts and supervisors; everyone else 403); publishing a
 * preview and withdrawing a published release (an EACC supervisor; everyone else 403).
 */
@ApiTags('open-data')
@Controller('v1/eacc/open-data/releases')
export class OpenDataController {
  constructor(private readonly openData: OpenDataService) {}

  @Get()
  @ApiOperation({
    operationId: 'listOpenDataReleasesEacc',
    summary: 'All releases including previews and withdrawn (EACC)',
  })
  @ApiOkResponse({ description: 'Releases' })
  @ApiProblemResponse(403, EACC_ONLY)
  list(@CurrentPrincipal() principal: Principal): Promise<OpenDataReleaseView[]> {
    return this.openData.list(principal);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireIdempotencyKey()
  @ApiOperation({
    operationId: 'buildOpenDataSnapshot',
    summary:
      'Build a snapshot release for a financial year as a preview (EACC analyst or supervisor)',
  })
  @ApiOkResponse({ description: 'Built as a preview' })
  @ApiProblemResponse(400, 'Body failed validation, or Idempotency-Key missing')
  @ApiProblemResponse(403, EACC_ONLY)
  @ApiProblemResponse(409, 'Problem code `ncr-not-built` or `reconciliation-failed`')
  @ApiProblemResponse(503, 'Object storage could not be reached')
  buildSnapshot(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(snapshotBody)) body: SnapshotBody,
  ): Promise<OpenDataReleaseView> {
    return this.openData.buildSnapshot(principal, body.fy);
  }

  @Post(':releaseId/publish')
  @HttpCode(HttpStatus.OK)
  @ApiReleaseIdParam()
  @ApiOperation({
    operationId: 'publishOpenDataRelease',
    summary: 'Publish a preview release (EACC supervisor)',
  })
  @ApiOkResponse({ description: 'Published' })
  @ApiProblemResponse(403, SUPERVISOR_ONLY)
  @ApiProblemResponse(404, 'No release has the id')
  @ApiProblemResponse(409, 'Problem code `release-not-preview`')
  @ApiProblemResponse(502, 'Problem code `manifest-refused`')
  @ApiProblemResponse(503, 'Documents or object storage could not be reached')
  publish(
    @CurrentPrincipal() principal: Principal,
    @Param('releaseId', new ZodValidationPipe(z.uuid())) releaseId: string,
  ): Promise<OpenDataReleaseView> {
    return this.openData.publish(principal, releaseId);
  }

  @Post(':releaseId/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiReleaseIdParam()
  @ApiOperation({
    operationId: 'withdrawOpenDataRelease',
    summary: 'Withdraw a published release with a public reason (EACC supervisor)',
  })
  @ApiOkResponse({ description: 'Withdrawn' })
  @ApiProblemResponse(400, 'Body failed validation')
  @ApiProblemResponse(403, SUPERVISOR_ONLY)
  @ApiProblemResponse(404, 'No release has the id')
  @ApiProblemResponse(409, 'Problem code `release-not-published`')
  withdraw(
    @CurrentPrincipal() principal: Principal,
    @Param('releaseId', new ZodValidationPipe(z.uuid())) releaseId: string,
    @Body(new ZodValidationPipe(withdrawBody)) body: WithdrawBody,
  ): Promise<OpenDataReleaseView> {
    return this.openData.withdraw(principal, releaseId, body.reason);
  }
}
