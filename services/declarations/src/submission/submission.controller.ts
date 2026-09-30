import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  IdempotencyKey,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
} from '@adili/api-kit';

import type { SubmissionResult } from './representation.js';
import { SubmissionService } from './submission.service.js';

/**
 * Submission (spec 06). Declarant only, by the `person_id` claim: any other caller, staff
 * included, gets 404 as if the declaration did not exist.
 */
@ApiTags('submission')
@Controller('v1')
export class SubmissionController {
  constructor(private readonly submission: SubmissionService) {}

  @Post('declarations/:declarationId/submit')
  @HttpCode(HttpStatus.CREATED)
  @RequireIdempotencyKey()
  @ApiParam({ name: 'declarationId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'submitDeclaration',
    summary: 'Submit the declaration (the legal act)',
    description:
      'Requires a token with the step-up ACR and auth_time within 5 minutes, and an Idempotency-Key (a retry with the same key gets the same answer). One transaction: validate, allocate the reference (first version), write the immutable version and items, mark submitted, file the obligation (late after its due date), record `declaration.submitted.v1` and `obligation.status-changed.v1`. The acknowledgement slip is issued asynchronously afterwards.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Submitted; acknowledgement pending',
    schema: schemaRef('SubmissionResult'),
  })
  @ApiProblemResponse(
    400,
    'Problem code `incomplete` with `blocking`, or the Idempotency-Key header missing (`idempotency-key-missing`)',
    'SubmitProblem',
  )
  @ApiProblemResponse(403, 'Problem code `step-up-required` with `stepUpUrl`', 'SubmitProblem')
  @ApiProblemResponse(404, 'Not found, or not visible to the caller')
  @ApiProblemResponse(
    409,
    'Problem code `not-a-draft`, `before-statement-date`, `amendment-window-closed` or `obligation-cancelled`; or a request with the same Idempotency-Key still running (`idempotency-key-in-use`)',
    'SubmitProblem',
  )
  submit(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<SubmissionResult> {
    return this.submission.submit(principal, declarationId, idempotencyKey);
  }
}
