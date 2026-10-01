import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  AcceptIdempotencyKey,
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { APPLICANT } from '@adili/roles';
import { z } from 'zod';

import type { AccessRequest } from './representation.js';
import { RequestsService } from './requests.service.js';

const REQUEST_ID = { name: 'requestId', schema: { type: 'string', format: 'uuid' } } as const;

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
    description:
      "The request is `submitted`, or `pending-applicant-verification` while the applicant's identity is pending in the directory (a passport holder no access officer has verified yet). The acknowledgement (email and SMS, with the reference) follows from the `access.request.received.v1` event.",
  })
  @ApiBody({ required: true, schema: schemaRef('FormK') })
  @ApiCreatedResponse({ description: 'Received', schema: schemaRef('AccessRequest') })
  @ApiProblemResponse(
    400,
    'Not a valid form-k.v1 document (`errors` name the paths), or no such Responsible Commission',
  )
  @ApiProblemResponse(
    403,
    'Problem code `no-applicant-record`: the account has no applicant person record',
  )
  @ApiProblemResponse(503, 'The directory or the key service cannot be reached; nothing was stored')
  submit(@CurrentPrincipal() principal: Principal, @Body() body: unknown): Promise<AccessRequest> {
    return this.requests.submit(principal, body);
  }

  @Get()
  @Roles(APPLICANT)
  @ApiOperation({
    operationId: 'listMyAccessRequests',
    summary: "The applicant's requests, latest first",
    description:
      "Their own only. Each timeline leaves out the declarant's representations and names no actor but the applicant.",
  })
  @ApiOkResponse({
    description: 'Requests',
    schema: { type: 'array', items: schemaRef('AccessRequest') },
  })
  @ApiProblemResponse(403, 'Not an applicant, or problem code `no-applicant-record`')
  @ApiProblemResponse(503, 'The key service cannot be reached')
  list(@CurrentPrincipal() principal: Principal): Promise<AccessRequest[]> {
    return this.requests.list(principal);
  }

  @Get(':requestId')
  @Roles(APPLICANT)
  @ApiParam(REQUEST_ID)
  @ApiOperation({
    operationId: 'getMyAccessRequest',
    summary: 'One request with decision and package status (applicant)',
  })
  @ApiOkResponse({ description: 'Request', schema: schemaRef('AccessRequest') })
  @ApiProblemResponse(400, 'requestId is not a UUID')
  @ApiProblemResponse(403, 'Not an applicant, or problem code `no-applicant-record`')
  @ApiProblemResponse(404, 'No such request of the applicant')
  @ApiProblemResponse(503, 'The key service cannot be reached')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
  ): Promise<AccessRequest> {
    return this.requests.get(principal, requestId);
  }

  @Post(':requestId/withdraw')
  @HttpCode(HttpStatus.OK)
  @Roles(APPLICANT)
  @AcceptIdempotencyKey()
  @ApiParam(REQUEST_ID)
  @ApiOperation({
    operationId: 'withdrawAccessRequest',
    summary: 'Withdraw before a decision',
    description:
      'Any status before a decision becomes `withdrawn`, recorded in the access register (`access.request.withdrawn.v1`).',
  })
  @ApiOkResponse({ description: 'Withdrawn', schema: schemaRef('AccessRequest') })
  @ApiProblemResponse(400, 'requestId is not a UUID')
  @ApiProblemResponse(403, 'Not an applicant, or problem code `no-applicant-record`')
  @ApiProblemResponse(404, 'No such request of the applicant')
  @ApiProblemResponse(
    409,
    'Problem code `request-decided` (a decision is final) or `request-closed` (withdrawn already, or the officer could not be identified)',
  )
  withdraw(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
  ): Promise<AccessRequest> {
    return this.requests.withdraw(principal, requestId);
  }
}
