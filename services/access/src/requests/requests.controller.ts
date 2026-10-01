import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  Roles,
  schemaRef,
} from '@adili/api-kit';
import { APPLICANT } from '@adili/roles';

import type { AccessRequest } from './representation.js';
import { RequestsService } from './requests.service.js';

/** Form K access requests as their applicant files and follows them (spec 10). */
@ApiTags('applicant')
@Controller('v1/access/requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(APPLICANT)
  @RequireIdempotencyKey()
  @ApiOperation({
    operationId: 'submitAccessRequest',
    summary: 'Submit Form K (applicant); allocates the ARQ reference and acknowledges',
  })
  @ApiBody({ required: true, schema: schemaRef('FormK') })
  @ApiCreatedResponse({ description: 'Received', schema: schemaRef('AccessRequest') })
  @ApiProblemResponse(
    400,
    'Not a valid form-k.v1 document (`errors` name the paths), or no such Responsible Commission',
  )
  @ApiProblemResponse(403, 'Problem code `no-applicant-record`: the account has no person record')
  @ApiProblemResponse(503, 'The directory or the key service cannot be reached; nothing was stored')
  submit(@CurrentPrincipal() principal: Principal, @Body() body: unknown): Promise<AccessRequest> {
    return this.requests.submit(principal, body);
  }
}
