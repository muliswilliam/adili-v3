import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
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
  schemaRef,
  Scopes,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { MessagesService } from './messages.service.js';
import type { MessageView } from './representation.js';
import { type SendMessage, sendMessageSchema } from './send-message.schema.js';

/** Internal: not routed by the public entrypoint. Callers are services with the messages scope. */
@ApiTags('internal')
@ApiBearerAuth()
@Scopes('messages')
@Controller('internal/v1/messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post()
  @AcceptIdempotencyKey()
  @ApiOperation({
    operationId: 'sendMessage',
    summary: 'Render a template and send it by email or SMS',
    description:
      'Synchronous with a 5-second budget. A provider failure is not an error: the message is created with status `failed` and the reason in `error`. With an `Idempotency-Key` (optional; keys are per caller, kept 24 hours) a retry gets the first answer back instead of a second message.',
  })
  @ApiBody({ required: true, schema: schemaRef('SendMessage') })
  @ApiCreatedResponse({
    description: 'Message handed to the provider (or failed, see status)',
    schema: schemaRef('Message'),
  })
  @ApiProblemResponse(400, 'Unknown template, or a recipient or params the template rejects')
  @ApiProblemResponse(403, 'Caller lacks the messages scope')
  send(
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessage,
    @CurrentPrincipal() caller: Principal,
  ): Promise<MessageView> {
    return this.messages.send(body, caller);
  }

  @Get(':id')
  @ApiOperation({
    operationId: 'getMessage',
    summary: 'Delivery status of a message',
    description: 'Only the service that sent the message sees it.',
  })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ description: 'The message', schema: schemaRef('Message') })
  @ApiProblemResponse(400, 'The id is not a UUID')
  @ApiProblemResponse(403, 'Caller lacks the messages scope')
  @ApiProblemResponse(404, 'No message with this id, or another caller sent it')
  async get(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @CurrentPrincipal() caller: Principal,
  ): Promise<MessageView> {
    // Another caller's message is indistinguishable from a missing one.
    const message = await this.messages.get(id, caller);
    if (!message) {
      throw new NotFoundException('No message with this id');
    }
    return message;
  }
}
