import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  CurrentPrincipal,
  type Principal,
  schemaRef,
  TENANT_KEY,
  ZodValidationPipe,
} from '@adili/api-kit';

import { type QueueQuery, queueQuery } from './queue-query.js';
import { QueueService } from './queue.service.js';
import type { CasePage, QueueSummary, ReviewerList } from './representation.js';
import { ReviewersService } from './reviewers.service.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';

/** The `slug` path parameter, as the contract's `Slug`. */
const ApiSlugParam = () =>
  ApiParam({ name: 'slug', schema: { type: 'string', pattern: TENANT_KEY.source } });

@ApiTags('queue')
@Controller('v1/commissions/:slug/review/queue')
export class QueueController {
  constructor(
    private readonly queue: QueueService,
    private readonly reviewers: ReviewersService,
  ) {}

  @Get()
  @ApiSlugParam()
  @ApiOperation({
    operationId: 'listReviewQueue',
    summary: 'Cases of the Commission ordered by score then age',
    description:
      "Reviewers and supervisors of the Commission. Anyone else, including another Commission's staff, gets 404.",
  })
  @ApiQueryParameters(queueQuery)
  @ApiOkResponse({
    description: 'Page',
    schema: {
      type: 'object',
      required: ['items', 'nextCursor'],
      properties: {
        items: { type: 'array', items: schemaRef('CaseListItem') },
        nextCursor: { type: ['string', 'null'] },
      },
    },
  })
  @ApiProblemResponse(400, 'Query failed validation, or the cursor is unknown')
  @ApiProblemResponse(404, NOT_VISIBLE)
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(queueQuery)) query: QueueQuery,
  ): Promise<CasePage> {
    return this.queue.list(principal, slug, query);
  }

  @Get('summary')
  @ApiSlugParam()
  @ApiOperation({
    operationId: 'getReviewQueueSummary',
    summary: 'Counts by status and priority band',
  })
  @ApiOkResponse({ description: 'Summary', schema: schemaRef('QueueSummary') })
  @ApiProblemResponse(404, NOT_VISIBLE)
  summary(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
  ): Promise<QueueSummary> {
    return this.queue.summary(principal, slug);
  }

  @Get('reviewers')
  @ApiSlugParam()
  @ApiOperation({
    operationId: 'listCommissionReviewers',
    summary: 'Reviewers and supervisors a case can be given to, with the cases they hold',
    description:
      "Supervisors of the Commission (a reviewer gets 403 `supervisor-required`; anyone else 404). The Commission's enabled reviewer and supervisor accounts as the directory has them, by name, each with the cases of the Commission they hold that are not determined. For the reassign dialog and the queue's assignee filter.",
  })
  @ApiOkResponse({ description: 'Reviewers', schema: schemaRef('ReviewerList') })
  @ApiProblemResponse(403, 'Problem type `supervisor-required`')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(502, 'Directory unavailable')
  listReviewers(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
  ): Promise<ReviewerList> {
    return this.reviewers.list(principal, slug);
  }
}
