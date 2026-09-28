import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  PROBLEM_CONTENT_TYPE,
  ProblemException,
  schemaRef,
  Scopes,
  ZodValidationPipe,
} from '@adili/api-kit';
import type { FastifyReply } from 'fastify';

import { type IprsPerson, type LookupIprsPerson, lookupIprsPersonSchema } from './iprs-person.js';
import { IprsLookupService } from './iprs-lookup.service.js';

/** Whether the answer (found or not found) came from the 24-hour cache. */
const X_CACHE = {
  'X-Cache': {
    description: '`hit` when the answer came from the cache, `miss` when IPRS was asked',
    schema: { type: 'string', enum: ['hit', 'miss'] },
  },
};

/** Internal: not routed by the public entrypoint. Callers are services with the iprs scope. */
@ApiTags('internal')
@ApiBearerAuth()
@Scopes('iprs')
@Controller('internal/v1/iprs')
export class IprsController {
  constructor(private readonly iprs: IprsLookupService) {}

  /**
   * A read, posted so the national ID travels in the body: URLs end up in access logs, traces
   * and problem details. Safe to repeat; it changes nothing but the verification-results log.
   */
  @Post('person-lookups')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'lookupIprsPerson',
    summary: 'Person as held by IPRS, cached for 24 hours (hits and misses)',
    description:
      'A read, posted so the national ID travels in the body rather than the URL (URLs end up in access logs, traces and problem details). Safe to repeat. Requires a service token with scope `iprs`.',
  })
  @ApiBody({ required: true, schema: schemaRef('LookupIprsPerson') })
  @ApiOkResponse({ description: 'Person found', schema: schemaRef('IprsPerson'), headers: X_CACHE })
  @ApiProblemResponse(400, 'National ID missing or malformed')
  @ApiResponse({
    status: 404,
    description: 'Problem type `not-found`: IPRS has no person with this national ID',
    headers: X_CACHE,
    content: { [PROBLEM_CONTENT_TYPE]: { schema: schemaRef('ProblemDetails') } },
  })
  @ApiProblemResponse(503, 'Problem type `upstream-unavailable`: circuit open or timeout')
  async lookupPerson(
    @Body(new ZodValidationPipe(lookupIprsPersonSchema)) body: LookupIprsPerson,
    @CurrentPrincipal() caller: Principal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<IprsPerson> {
    const result = await this.iprs.lookup(body.nationalId, caller);
    if (result.outcome === 'unavailable') {
      throw new ProblemException({
        type: 'upstream-unavailable',
        title: 'IPRS unavailable',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: 'IPRS is not responding. Try again in a few minutes.',
      });
    }
    void reply.header('x-cache', result.cached ? 'hit' : 'miss');
    if (result.outcome === 'not-found') {
      throw new ProblemException({
        type: 'not-found',
        title: 'No IPRS record',
        status: HttpStatus.NOT_FOUND,
        detail: 'IPRS has no person with this national ID.',
      });
    }
    return result.person;
  }
}
