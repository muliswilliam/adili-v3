import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiJsonBody,
  ApiProblemResponse,
  RequireIdempotencyKey,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { DeclarantPerson } from '../clarifications/access.js';
import {
  DeclarantNoticesService,
  type NoticeResponseInput,
  noticeResponseInput,
} from './declarant-notices.service.js';
import type { DeclarantNoticeView } from './representation.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';

/**
 * The declarant's notices (spec 08), authorised by the `person_id` claim: tokens without it, and
 * other people's notices, get 404.
 */
@ApiTags('declarant')
@Controller('v1/me/notices')
export class DeclarantNoticesController {
  constructor(private readonly notices: DeclarantNoticesService) {}

  @Get()
  @ApiOperation({
    operationId: 'getMyNotices',
    summary: "The declarant's issued administrative actions with statuses",
  })
  @ApiOkResponse({
    description: 'List',
    schema: { type: 'array', items: schemaRef('DeclarantNotice') },
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  list(@DeclarantPerson() personId: string): Promise<DeclarantNoticeView[]> {
    return this.notices.list(personId);
  }

  @Post(':actionId/response')
  @RequireIdempotencyKey()
  @ApiParam({ name: 'actionId', schema: { type: 'string', format: 'uuid' } })
  @ApiJsonBody(noticeResponseInput)
  @ApiOperation({
    operationId: 'respondToNotice',
    summary: 'Respond once to a notice or warning with text and attachments',
  })
  @ApiCreatedResponse({ description: 'Responded', schema: schemaRef('DeclarantNotice') })
  @ApiProblemResponse(400, 'Body failed validation')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'Problem code `already-responded`, `notice-closed`, `attachment-not-clean` or `attachment-not-accepted`',
  )
  @ApiProblemResponse(503, 'The documents service could not check the attachments')
  respond(
    @DeclarantPerson() personId: string,
    @Param('actionId', new ZodValidationPipe(z.uuid())) actionId: string,
    @Body(new ZodValidationPipe(noticeResponseInput)) body: NoticeResponseInput,
  ): Promise<DeclarantNoticeView> {
    return this.notices.respond(personId, actionId, body);
  }
}
