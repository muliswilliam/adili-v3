import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  AcceptIdempotencyKey,
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { DECLARANT } from '@adili/roles';
import { z } from 'zod';

import { NoticesService } from './notices.service.js';
import {
  type DeclarantNotice,
  type FormKDeclarantNotice,
  type RepresentationsInput,
  representationsInputSchema,
} from './representation.js';

/** The access requests about a declarant, as the declarant sees and answers them (spec 10). */
@ApiTags('declarant')
@Controller('v1/me/access-notices')
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get()
  @Roles(DECLARANT)
  @ApiOperation({
    operationId: 'listMyAccessNotices',
    summary: 'Requests the declarant has been notified about, with windows and outcomes',
    description:
      "Their own only, latest notified first: Form K requests from notification on; law enforcement requests (kind `lea`: the agency, its case reference, the outcome and the dates only, never the agency's reason or the decision's reasons or grounds; no representations) only once granted and the declarant told (r.23(2)). Form K notices carry the applicant's reason verbatim.",
  })
  @ApiOkResponse({
    description: 'Notices',
    schema: { type: 'array', items: schemaRef('DeclarantNotice') },
  })
  @ApiProblemResponse(404, 'Not a declarant')
  @ApiProblemResponse(503, 'The key service cannot be reached')
  list(@CurrentPrincipal() principal: Principal): Promise<DeclarantNotice[]> {
    return this.notices.list(principal);
  }

  @Put(':requestId/representations')
  @Roles(DECLARANT)
  @AcceptIdempotencyKey()
  @ApiParam({ name: 'requestId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'submitRepresentations',
    summary: 'Create or update representations within the window',
    description:
      'One submission per request, changed as often as needed until the window closes (`access.request.representations.v1` each time). `consent` puts the request under decision at once and closes the window.',
  })
  @ApiBody({ required: true, schema: schemaRef('RepresentationsInput') })
  @ApiOkResponse({ description: 'Saved', schema: schemaRef('FormKDeclarantNotice') })
  @ApiProblemResponse(
    400,
    'requestId is not a UUID, the body failed validation, or an attachment is not a clean `access-representation` upload of the declarant',
  )
  @ApiProblemResponse(404, 'No such request about the declarant that they were notified of')
  @ApiProblemResponse(
    409,
    'Problem code `representations-closed`: the window has closed (or the declarant consented, or the request closed)',
  )
  @ApiProblemResponse(503, 'Documents or the key service cannot be reached; nothing was saved')
  submit(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @Body(new ZodValidationPipe(representationsInputSchema)) body: RepresentationsInput,
  ): Promise<FormKDeclarantNotice> {
    return this.notices.submit(principal, requestId, body);
  }
}
