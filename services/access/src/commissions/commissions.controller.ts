import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, Roles, schemaRef } from '@adili/api-kit';
import { APPLICANT } from '@adili/roles';

import { CommissionsService } from './commissions.service.js';
import type { AccessCommission } from './representation.js';

/** The Responsible Commissions an applicant chooses among in Form K (spec 10). */
@ApiTags('applicant')
@Controller('v1/access/commissions')
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @Get()
  @Roles(APPLICANT)
  @ApiOperation({
    operationId: 'listAccessCommissions',
    summary: 'Commissions an applicant can address, with the declaration years available',
    description:
      "Every active Responsible Commission in the directory, by name. `years` are the statement-date years a Form K's scope can ask of it: from the year it joined Adili (its earliest obligations-start date, not before 2025) to the current year in Nairobi; empty while it holds no declarations yet. Platform reference data: no personal data.",
  })
  @ApiOkResponse({
    description: 'Commissions',
    schema: { type: 'array', items: schemaRef('AccessCommission') },
  })
  @ApiProblemResponse(403, 'Not an applicant')
  @ApiProblemResponse(503, 'Problem type `directory-unavailable`: the directory cannot be reached')
  list(): Promise<AccessCommission[]> {
    return this.commissions.list();
  }
}
