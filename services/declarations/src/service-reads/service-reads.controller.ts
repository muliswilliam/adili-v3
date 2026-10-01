import {
  Body,
  Controller,
  createParamDecorator,
  type ExecutionContext,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
  ApiQueryParameters,
  AuditedRead,
  CurrentPrincipal,
  CurrentReadAudit,
  InternalApi,
  type Principal,
  type ReadAudit,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { DECLARATIONS_INTERNAL_SCOPE } from '@adili/roles';
import { z } from 'zod';

import { versionNumber } from '../declaration/versions.js';
import { ApiVersionParams } from '../http.js';
import { ServiceObligationsService } from './obligations.service.js';
import {
  type InternalObligation,
  type InternalObligationDetails,
  type InternalPersonObligation,
  type InternalPreviousVersion,
  type InternalVersionDocument,
  type ObligationDetailsRequest,
  obligationDetailsRequest,
  type PreviousVersionQuery,
  previousVersionQuery,
} from './representation.js';
import { ServiceVersionsService } from './versions.service.js';

const CALLERS =
  'Service tokens with scope declarations:internal, acting for the Commission in X-Acting-Tenant';
const uuid = new ZodValidationPipe(z.uuid());

/** The request's headers, for a validation pipe. */
const RequestHeaders = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>().headers,
);

/** Whom a version is read for: the staff subject (required) and the case (optional). */
const versionReadHeaders = z.object({
  'x-acting-subject': z.string().trim().min(1).max(255),
  'x-review-case': z.uuid().optional(),
});
type VersionReadHeaders = z.infer<typeof versionReadHeaders>;

/** Internal: submitted versions as the review service reads them (spec 07a). */
@ApiTags('internal')
@Controller('internal/v1/declarations')
@InternalApi(DECLARATIONS_INTERNAL_SCOPE)
export class InternalVersionsController {
  constructor(private readonly versions: ServiceVersionsService) {}

  @Get(':declarationId/versions/:version/document')
  @AuditedRead({ action: 'declaration.version-document.read', resource: 'declaration-version' })
  @ApiVersionParams()
  @ApiHeader({
    name: 'X-Acting-Subject',
    required: true,
    description: 'Staff subject on whose behalf the content is read; recorded in the audit event',
    schema: { type: 'string' },
  })
  @ApiHeader({
    name: 'X-Review-Case',
    required: false,
    description: "The review case the read is for; recorded as the audit event's legal basis",
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({
    operationId: 'internalGetVersionDocument',
    summary:
      'Decrypted declaration.v1 document of a submitted version, for the review service (audited read)',
    description: `${CALLERS}; audited with the subject it reads for and the case. The version as filed, with the declarant's name, file number and due date and the attachments of its items.`,
  })
  @ApiOkResponse({
    description: 'Document and metadata',
    schema: schemaRef('InternalVersionDocument'),
  })
  @ApiProblemResponse(400, 'X-Acting-Subject missing, or X-Review-Case not a UUID')
  @ApiProblemResponse(404, "No such version of the acting tenant's declarations")
  async document(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('declarationId', uuid) declarationId: string,
    @Param('version', versionNumber) version: number,
    // The audit event names the subject (the interceptor records it) and the case.
    @RequestHeaders(new ZodValidationPipe(versionReadHeaders)) headers: VersionReadHeaders,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<InternalVersionDocument> {
    const read = await this.versions.document(
      { tenant, subject: principal.subject },
      declarationId,
      version,
    );
    const caseId = headers['x-review-case'];
    audit.resource({ tenant, subjectPersonId: read.personId });
    if (caseId !== undefined) audit.legalBasis({ basis: 'review-case', reference: caseId });
    return read;
  }

  @Get('previous-version')
  @ApiQueryParameters(previousVersionQuery)
  @ApiOperation({
    operationId: 'internalFindPreviousVersion',
    summary: 'Latest earlier submitted version of the same person at the same Commission',
    description: `${CALLERS}. Identifiers and dates only. An earlier version of the same declaration counts.`,
  })
  @ApiOkResponse({
    description: 'Previous version reference',
    schema: schemaRef('InternalPreviousVersion'),
  })
  @ApiProblemResponse(400, 'Query failed validation')
  @ApiProblemResponse(404, 'No earlier submitted version')
  previous(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Query(new ZodValidationPipe(previousVersionQuery)) query: PreviousVersionQuery,
  ): Promise<InternalPreviousVersion> {
    return this.versions.previous({ tenant, subject: principal.subject }, query);
  }
}

/** Internal: filing obligations as the review and reporting services read them (specs 08, 09). */
@ApiTags('internal')
@Controller('internal/v1')
@InternalApi(DECLARATIONS_INTERNAL_SCOPE)
export class InternalObligationsController {
  constructor(private readonly obligations: ServiceObligationsService) {}

  @Get('obligations/:obligationId')
  @AuditedRead({ action: 'obligation.pulled', resource: 'filing-obligation' })
  @ApiParam({ name: 'obligationId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'internalGetObligation',
    summary: 'One filing obligation of the acting Commission (for the enforcement ladder)',
    description: `${CALLERS}; audited. The review service reads it when an obligation goes overdue (spec 08): whom the ladder addresses and what they failed to file. \`personId\` is null until the declarant onboards.`,
  })
  @ApiOkResponse({ description: 'The obligation', schema: schemaRef('InternalObligation') })
  @ApiProblemResponse(400, 'obligationId is not a UUID')
  @ApiProblemResponse(404, "No such obligation of the acting tenant's Commission")
  async obligation(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('obligationId', uuid) obligationId: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<InternalObligation> {
    const found = await this.obligations.obligation(
      { tenant, subject: principal.subject },
      obligationId,
    );
    audit.resource({ tenant, subjectPersonId: found.personId });
    return found;
  }

  @Get('persons/:personId/obligations')
  @AuditedRead({ action: 'obligation.history.pulled', resource: 'filing-obligation' })
  @ApiParam({ name: 'personId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'internalListPersonObligations',
    summary: "A person's filing obligations across cycles (for the referral sweep)",
    description: `${CALLERS}; audited. Oldest first: type, cycle, status, due date, and when it was filed and whether late; no names.`,
  })
  @ApiOkResponse({
    description: 'Obligations',
    schema: { type: 'array', items: schemaRef('InternalPersonObligation') },
  })
  @ApiProblemResponse(400, 'personId is not a UUID')
  @ApiProblemResponse(404, 'The acting tenant holds no obligation of the person')
  async personHistory(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('personId', uuid) personId: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<InternalPersonObligation[]> {
    const history = await this.obligations.personHistory(
      { tenant, subject: principal.subject },
      personId,
    );
    audit.resource({ tenant, subjectPersonId: personId });
    return history;
  }

  @Post('obligations/details')
  @HttpCode(200)
  @AuditedRead({ action: 'obligation.officers.pulled', resource: 'filing-obligation' })
  @ApiBody({ schema: z.toJSONSchema(obligationDetailsRequest) as object })
  @ApiOperation({
    operationId: 'internalObligationDetails',
    summary:
      "The officers behind a Commission's obligations, in a batch (spec 09 Form M non-filers)",
    description: `${CALLERS}; audited, naming the obligations read. At most 1,000 obligation ids; an obligation the Commission does not hold is left out. A read: it changes nothing, so it takes no Idempotency-Key and is safe to retry.`,
  })
  @ApiOkResponse({
    description: 'The officers, one per known obligation',
    schema: schemaRef('InternalObligationDetails'),
  })
  @ApiProblemResponse(400, 'Body failed validation: no ids, more than 1,000, or one not a UUID')
  async details(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Body(new ZodValidationPipe(obligationDetailsRequest)) body: ObligationDetailsRequest,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<InternalObligationDetails> {
    const details = await this.obligations.details(
      { tenant, subject: principal.subject },
      body.obligationIds,
    );
    // The trail names the obligations whose officers were read, not the ids asked for.
    audit.resource({ tenant, ids: details.items.map((item) => item.obligationId) });
    return details;
  }
}
