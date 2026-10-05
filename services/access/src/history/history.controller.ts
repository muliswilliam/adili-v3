import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  Roles,
  schemaRef,
} from '@adili/api-kit';
import { DECLARANT } from '@adili/roles';

import { HistoryService } from './history.service.js';
import type { AccessHistoryEntry } from './representation.js';

/** Who accessed the declarant's declaration (spec 10, ADR-008). */
@ApiTags('declarant')
@Controller('v1/me/access-history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get()
  @Roles(DECLARANT)
  @ApiOperation({
    operationId: 'getMyAccessHistory',
    summary: 'Who accessed my declaration (register entries visible to the declarant)',
    description:
      'Newest first: Form K requests about the declarant from notification on (notified, representations, decision, package, downloads, expiry, withdrawal), and their certified copies. Entries about a Form K request carry the applicant, the purpose the notice gave and the scope (requested before the decision, granted from it). Staff are not named. Law enforcement requests never show (product decision, 2026-10-05; #614).',
  })
  @ApiOkResponse({
    description: 'Entries',
    schema: { type: 'array', items: schemaRef('AccessHistoryEntry') },
  })
  @ApiProblemResponse(404, 'Not a declarant')
  @ApiProblemResponse(503, 'The key service cannot be reached')
  list(@CurrentPrincipal() principal: Principal): Promise<AccessHistoryEntry[]> {
    return this.history.list(principal);
  }
}
