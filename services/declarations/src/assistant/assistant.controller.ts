import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  RateLimit,
  schemaRef,
} from '@adili/api-kit';
import type { FastifyReply } from 'fastify';

import { ASSISTANT_RATE_LIMIT } from '../config.js';
import { AssistantService, unavailableFrame } from './assistant.service.js';
import type { AssistantConversation, AssistantMessage } from './representation.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';

/** Between SSE heartbeats, so proxies keep a quiet stream open. */
const HEARTBEAT_MS = 15_000;

/**
 * Ask Adili (spec 11): the declarant's conversation with the assistant and its answers, streamed
 * as server-sent events. The declarant's own by the `person_id` claim; anyone else gets 404.
 */
@ApiTags('assistant')
@Controller('v1/me/assistant/conversations')
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);

  constructor(private readonly assistant: AssistantService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'openAssistantConversation',
    summary: 'Open or resume the conversation for a draft (or for the declarant without a draft)',
    description:
      "Declarants (by the person_id claim). One conversation per draft, kept while it is a draft and deleted when it is discarded or submitted; one outside a draft (the dashboard), at the Commission of the declarant's latest filing obligation, deleted 30 days after its last message. Opening in another language switches it. 404 for a draft that is not the caller's or not being edited, for a declarant without a filing obligation outside a draft, and for any other caller.",
  })
  @ApiBody({ required: true, schema: schemaRef('OpenAssistantConversationRequest') })
  @ApiOkResponse({ description: 'Conversation', schema: schemaRef('AssistantConversation') })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(404, NOT_VISIBLE)
  open(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
  ): Promise<AssistantConversation> {
    return this.assistant.open(principal, body);
  }

  @Post(':conversationId/messages')
  @RateLimit(ASSISTANT_RATE_LIMIT)
  @ApiParam({ name: 'conversationId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'askAssistant',
    summary:
      'Ask a question; the answer streams back as server-sent events (`delta`, `final`, `error`) and is stored on completion',
    description:
      "Declarants, on their own conversation. The ai-gateway gets the question, the declaration's type and statement date, the household as counts, the section and what the completeness check still reports (rule ids and field paths), and the passages of the Act, Regulations and help articles retrieved for it (the platform's and the conversation's Commission's). Nothing the service adds carries amounts, names, identifiers or descriptions; the question and earlier turns are the declarant's words, which the gateway minimises. Events: `delta` {text}, the answer's prose as it is written, provisional until the end; then `final` {question, answer}, both turns as stored, whose answer replaces the deltas (an answer whose blocks do not all cite the passages retrieved is stored as a decline, with the reporting officer's contact); or `error` {code: assistant-unavailable}, after which nothing is stored. A `: ping` comment is sent every 15 s. A caller that disconnects ends the answer, and nothing is stored. Records `assistant.message.answered.v1`.",
  })
  @ApiBody({ required: true, schema: schemaRef('AskAssistantRequest') })
  @ApiResponse({
    status: 200,
    description:
      'SSE stream: `delta` {text}, then `final` {question, answer} (`AssistantAnswer`) or `error` {code}',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    503,
    "Problem type `assistant-unavailable`: the ai-gateway cannot answer now (unreachable, the Commission's limit or budget reached, no provider); nothing was stored. Use help search",
  )
  async ask(
    @CurrentPrincipal() principal: Principal,
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const stream = await this.assistant.ask(principal, conversationId, body);
    // Headers set before the stream (the rate limit's) go out with it.
    const headers = Object.fromEntries(
      Object.entries(reply.getHeaders()).filter(
        (entry): entry is [string, string | number | string[]] => entry[1] !== undefined,
      ),
    );
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(HttpStatus.OK, {
      ...headers,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    });
    const left = new AbortController();
    raw.on('close', () => {
      if (!raw.writableEnded) left.abort();
    });
    if (raw.destroyed) left.abort();
    const ping = setInterval(() => raw.write(': ping\n\n'), HEARTBEAT_MS);
    try {
      for await (const frame of stream.frames(left.signal)) {
        raw.write(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`);
      }
    } catch (error) {
      // Every ending the stream knows is a frame; this is a bug.
      this.logger.error({ err: error }, 'Answer stream failed');
      if (!left.signal.aborted) {
        const frame = unavailableFrame();
        raw.write(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`);
      }
    } finally {
      clearInterval(ping);
      raw.end();
    }
  }

  @Put(':conversationId/messages/:messageId/feedback')
  @ApiParam({ name: 'conversationId', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({ name: 'messageId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'rateAssistantMessage',
    summary: 'Rate an answer, with why and a note',
    description:
      "Declarants, on an answer in their own conversation. Forwarded to the ai-gateway job the answer came from (rating, reason and note), then kept on the answer, the reason and note encrypted; a decline made without asking the AI has no job and is kept only. A second rating replaces the first. Records `assistant.feedback.recorded.v1` (no reason, no note). 404 for a question, another person's message or a conversation gone with its draft.",
  })
  @ApiBody({ required: true, schema: schemaRef('RateAssistantMessageRequest') })
  @ApiOkResponse({ description: 'The answer, rated', schema: schemaRef('AssistantMessage') })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    503,
    'Problem type `assistant-unavailable`: the ai-gateway cannot take the rating now; nothing was kept',
  )
  rate(
    @CurrentPrincipal() principal: Principal,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Body() body: unknown,
  ): Promise<AssistantMessage> {
    return this.assistant.rate(principal, conversationId, messageId, body);
  }
}
