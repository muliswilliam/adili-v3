import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  AcceptIdempotencyKey,
  ApiJsonBody,
  ApiProblemResponse,
  AuditedRead,
  CurrentPrincipal,
  type Principal,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { AssignmentService } from './assignment.service.js';
import { CaseAnnotationsService } from './case-annotations.service.js';
import { CaseViewService } from './case-view.service.js';
import type {
  AttachmentDownload,
  CaseDetail,
  CaseListItem,
  FlagView,
  NoteView,
} from './representation.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';
const STAFF =
  "Reviewers and supervisors of the case's Commission. Anyone else, including another Commission's staff, gets 404.";

const uuidParam = (name: string) => ApiParam({ name, schema: { type: 'string', format: 'uuid' } });

const reassignBody = z.object({
  assignee: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .nullable()
    .meta({ description: 'Subject of a reviewer or supervisor of the Commission; null unassigns' }),
});

const noteBody = z.object({ text: z.string().trim().min(1).max(2000) });

const flagReviewedBody = z.object({ note: z.string().trim().min(1).max(1000) });

/**
 * A review case (spec 07a): its view with the declaration pulled on demand, attachment links,
 * assignment, internal notes and flags marked reviewed.
 */
@ApiTags('cases')
@Controller('v1/review/cases/:caseId')
export class CasesController {
  constructor(
    private readonly view: CaseViewService,
    private readonly assignment: AssignmentService,
    private readonly annotations: CaseAnnotationsService,
  ) {}

  @Get()
  @AuditedRead({ action: 'review.case.viewed', resource: 'review-case' })
  @uuidParam('caseId')
  @ApiOperation({
    operationId: 'getReviewCase',
    summary:
      'Case with flags, clarifications, notes, timeline and the declaration pulled on demand',
    description: `${STAFF} Every call reads the declaration from the declarations service, which audits it with the viewer and the case, and records review.case.viewed.v1.`,
  })
  @ApiOkResponse({ description: 'Case detail', schema: schemaRef('CaseDetail') })
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    502,
    'Declarations unavailable: the problem carries the case detail with a null document',
  )
  detail(
    @CurrentPrincipal() principal: Principal,
    @Param('caseId') caseId: string,
  ): Promise<CaseDetail> {
    return this.view.detail(principal, caseId);
  }

  @Get('attachments/:uploadId/download')
  @AuditedRead({ action: 'review.case.attachment.downloaded', resource: 'review-case' })
  @uuidParam('caseId')
  @uuidParam('uploadId')
  @ApiOperation({
    operationId: 'getCaseAttachmentDownload',
    summary:
      'Short-lived download link for an attachment of the declaration under review (audited)',
    description: `${STAFF} The upload must be an attachment of the version under review.`,
  })
  @ApiOkResponse({
    description: 'Link',
    schema: {
      type: 'object',
      required: ['downloadUrl', 'expiresAt'],
      properties: {
        downloadUrl: { type: 'string', format: 'uri' },
        expiresAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(502, 'Declarations or documents unavailable')
  attachmentDownload(
    @CurrentPrincipal() principal: Principal,
    @Param('caseId') caseId: string,
    @Param('uploadId') uploadId: string,
  ): Promise<AttachmentDownload> {
    return this.view.attachmentDownload(principal, caseId, uploadId);
  }

  @Post('claim')
  @AcceptIdempotencyKey()
  @HttpCode(200)
  @uuidParam('caseId')
  @ApiOperation({
    operationId: 'claimCase',
    summary: 'Assign an unassigned case to the caller',
    description: STAFF,
  })
  @ApiOkResponse({ description: 'Assigned', schema: schemaRef('CaseListItem') })
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Problem type `case-already-assigned`: another officer holds it')
  claim(
    @CurrentPrincipal() principal: Principal,
    @Param('caseId') caseId: string,
  ): Promise<CaseListItem> {
    return this.assignment.claim(principal, caseId);
  }

  @Post('release')
  @AcceptIdempotencyKey()
  @HttpCode(200)
  @uuidParam('caseId')
  @ApiOperation({
    operationId: 'releaseCase',
    summary: "Return the caller's case to the queue",
    description: `${STAFF} Only the officer holding the case releases it; others get 403.`,
  })
  @ApiOkResponse({ description: 'Unassigned', schema: schemaRef('CaseListItem') })
  @ApiProblemResponse(403, 'The caller does not hold the case')
  @ApiProblemResponse(404, NOT_VISIBLE)
  release(
    @CurrentPrincipal() principal: Principal,
    @Param('caseId') caseId: string,
  ): Promise<CaseListItem> {
    return this.assignment.release(principal, caseId);
  }

  @Put('assignment')
  @AcceptIdempotencyKey()
  @uuidParam('caseId')
  @ApiOperation({
    operationId: 'reassignCase',
    summary: 'Supervisor reassigns or unassigns a case',
    description: `${STAFF} Supervisors only; a reviewer gets 403.`,
  })
  @ApiJsonBody(reassignBody)
  @ApiOkResponse({ description: 'Updated', schema: schemaRef('CaseListItem') })
  @ApiProblemResponse(400, 'Body failed validation')
  @ApiProblemResponse(403, 'The caller is not a supervisor')
  @ApiProblemResponse(404, NOT_VISIBLE)
  reassign(
    @CurrentPrincipal() principal: Principal,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(reassignBody)) body: z.infer<typeof reassignBody>,
  ): Promise<CaseListItem> {
    return this.assignment.reassign(principal, caseId, body.assignee);
  }

  @Post('notes')
  @AcceptIdempotencyKey()
  @uuidParam('caseId')
  @ApiOperation({
    operationId: 'addCaseNote',
    summary: 'Add an internal note',
    description: `${STAFF} The declarant never sees notes.`,
  })
  @ApiJsonBody(noteBody)
  @ApiCreatedResponse({ description: 'Note', schema: schemaRef('Note') })
  @ApiProblemResponse(400, 'Body failed validation')
  @ApiProblemResponse(404, NOT_VISIBLE)
  addNote(
    @CurrentPrincipal() principal: Principal,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(noteBody)) body: z.infer<typeof noteBody>,
  ): Promise<NoteView> {
    return this.annotations.addNote(principal, caseId, body.text);
  }

  @Post('flags/:flagId/reviewed')
  @AcceptIdempotencyKey()
  @HttpCode(200)
  @uuidParam('caseId')
  @uuidParam('flagId')
  @ApiOperation({
    operationId: 'markFlagReviewed',
    summary: 'Record that a flag was considered, with a note',
    description: `${STAFF} Once per flag.`,
  })
  @ApiJsonBody(flagReviewedBody)
  @ApiOkResponse({ description: 'Flag', schema: schemaRef('Flag') })
  @ApiProblemResponse(400, 'Body failed validation')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Problem type `flag-already-reviewed`')
  markFlagReviewed(
    @CurrentPrincipal() principal: Principal,
    @Param('caseId') caseId: string,
    @Param('flagId') flagId: string,
    @Body(new ZodValidationPipe(flagReviewedBody)) body: z.infer<typeof flagReviewedBody>,
  ): Promise<FlagView> {
    return this.annotations.markFlagReviewed(principal, caseId, flagId, body.note);
  }
}
