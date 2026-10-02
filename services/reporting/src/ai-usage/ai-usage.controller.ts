import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { FIRST_FINANCIAL_YEAR } from '../financial-year.js';
import { type AiUsageReport, AiUsageService } from './ai-usage.service.js';

/**
 * The AI reviewer copilot's counts per Commission (spec 07c story 19): AI-assisted cases and
 * reviewers' ratings for a financial year, without content (EACC analysts and supervisors;
 * everyone else 403).
 */
@ApiTags('eacc')
@Controller('v1/eacc/ai-usage')
export class AiUsageController {
  constructor(private readonly usage: AiUsageService) {}

  @Get(':fy')
  @ApiParam({
    name: 'fy',
    description: 'Financial year start year, e.g. 2027 for 1 July 2027 to 30 June 2028',
    schema: { type: 'integer', minimum: FIRST_FINANCIAL_YEAR },
  })
  @ApiOperation({
    operationId: 'getAiUsage',
    summary: 'AI-assisted cases and reviewer ratings per Commission for a financial year (EACC)',
  })
  @ApiOkResponse({ description: 'Counts' })
  @ApiProblemResponse(400, 'fy is not a financial year')
  @ApiProblemResponse(403, 'Only EACC analysts and supervisors')
  report(
    @CurrentPrincipal() principal: Principal,
    // reporting.yaml `FinancialYear`: the start year, e.g. 2027 for 1 July 2027 to 30 June 2028.
    @Param('fy', new ZodValidationPipe(z.coerce.number().int().min(FIRST_FINANCIAL_YEAR)))
    fy: number,
  ): Promise<AiUsageReport> {
    return this.usage.report(principal, fy);
  }
}
