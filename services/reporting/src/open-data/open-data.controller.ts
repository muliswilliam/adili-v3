import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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

const EACC_ONLY = 'Only EACC analysts and supervisors';

/**
 * EACC's open-data releases (spec 09b): the list, previews and withdrawn included, and building a
 * mid-year snapshot as a preview (EACC analysts and supervisors; everyone else 403).
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
}
