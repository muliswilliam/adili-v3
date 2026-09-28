import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentPrincipal, type Principal, Scopes, ZodValidationPipe } from '@adili/api-kit';
import { z } from 'zod';

import { type MessageView, MessagesService } from './messages.service.js';
import { type SendMessage, sendMessageSchema } from './send-message.schema.js';

/** Internal: not routed by the public entrypoint. Callers are services with the messages scope. */
@ApiTags('internal')
@ApiBearerAuth()
@Scopes('messages')
@Controller('internal/v1/messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post()
  @ApiOperation({
    operationId: 'sendMessage',
    summary: 'Render a template and send it by email or SMS',
    description: 'Synchronous with a 5-second budget. A provider failure is status failed.',
  })
  @ApiCreatedResponse({ description: 'Message handed to the provider (or failed, see status)' })
  send(
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessage,
    @CurrentPrincipal() caller: Principal,
  ): Promise<MessageView> {
    return this.messages.send(body, caller);
  }

  @Get(':id')
  @ApiOperation({ operationId: 'getMessage', summary: 'Delivery status of a message' })
  @ApiOkResponse({ description: 'The message' })
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
