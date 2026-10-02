import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, Roles, schemaRef } from '@adili/api-kit';
import { APPLICANT, LAW_ENFORCEMENT } from '@adili/roles';

import { CommissionsService } from './commissions.service.js';
import type { AccessCommission } from './representation.js';

/**
 * The Responsible Commissions an applicant chooses among in Form K, and a law enforcement officer
 * in a written request (spec 10).
 */
@ApiTags('applicant')
@Controller('v1/access/commissions')
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @Get()
  @Roles(APPLICANT, LAW_ENFORCEMENT)
  @ApiOperation({
    operationId: 'listAccessCommissions',
    summary:
      'Commissions an applicant or a law enforcement officer can address, with the declaration years available',
    description:
      'Every active Responsible Commission in the directory, by name. `years` are the statement-date years the scope of a Form K or a law enforcement request can ask of it: from the year it joined Adili (its earliest obligations-start date, not before 2025) to the current year in Nairobi; empty while it holds no declarations yet. Platform reference data: no personal data.',
  })
  @ApiOkResponse({
    description: 'Commissions',
    schema: { type: 'array', items: schemaRef('AccessCommission') },
  })
  @ApiProblemResponse(403, 'Neither an applicant nor a law enforcement officer')
  @ApiProblemResponse(503, 'Problem type `directory-unavailable`: the directory cannot be reached')
  list(): Promise<AccessCommission[]> {
    return this.commissions.list();
  }
}
