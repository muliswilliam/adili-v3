import { Controller, Get, HttpStatus, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
  AuditedRead,
  CurrentReadAudit,
  InternalApi,
  notFoundIfInvisible,
  ProblemException,
  type ReadAudit,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { FieldCipherError } from '@adili/data-access';
import { REGISTRY_SCOPE } from '@adili/roles';
import { z } from 'zod';

import { type StoredResult, VerificationResults } from './verification-results.js';

/**
 * Stored lookup results, read back by the services of the tenant the lookup acted for: the
 * Registry tab shows registry records from here, on demand, rather than keeping them in review.
 */
@ApiTags('internal')
@ApiBearerAuth()
@InternalApi(REGISTRY_SCOPE)
@Controller('internal/v1/verification-results')
export class StoredResultsController {
  constructor(private readonly results: VerificationResults) {}

  @Get(':resultId')
  @AuditedRead({ action: 'verification-result.read', resource: 'verification-result' })
  @ApiOperation({
    operationId: 'getVerificationResult',
    summary: 'A stored lookup result, decrypted for the services of its tenant (audited)',
    description: `The normalised records of a found lookup (payload), with its system, outcome, legal basis and case reference. Each read is audited (audit.read.v1) under the tenant, naming the person the lookup was about (X-Subject-Person at lookup). Requires a service token with scope \`${REGISTRY_SCOPE}\` acting for the tenant the lookup acted for.`,
  })
  @ApiParam({ name: 'resultId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ description: 'The stored result', schema: schemaRef('StoredResult') })
  @ApiProblemResponse(HttpStatus.NOT_FOUND, "No such result, or another tenant's")
  @ApiProblemResponse(
    HttpStatus.SERVICE_UNAVAILABLE,
    'Problem type `upstream-unavailable`: the key service could not decrypt the payload now',
  )
  async read(
    @Param('resultId', new ZodValidationPipe(z.uuid())) resultId: string,
    @ActingTenant() tenant: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<StoredResult> {
    try {
      const { result, subjectPersonId } = notFoundIfInvisible(
        await this.results.read(resultId, tenant),
      );
      // ADR-008: "who accessed my data" lists this read under the person the lookup was about.
      audit.resource({ tenant, subjectPersonId });
      return result;
    } catch (error) {
      if (error instanceof FieldCipherError && error.code === 'unavailable') {
        throw new ProblemException({
          type: 'upstream-unavailable',
          title: 'Key service unavailable',
          status: HttpStatus.SERVICE_UNAVAILABLE,
          detail: 'The stored result cannot be decrypted right now. Try again shortly.',
        });
      }
      throw error;
    }
  }
}
