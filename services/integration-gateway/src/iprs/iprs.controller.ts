import { Controller, Get, HttpStatus, Param, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentPrincipal,
  type Principal,
  ProblemException,
  RequireScopes,
  ZodValidationPipe,
} from '@adili/api-kit';
import type { FastifyReply } from 'fastify';

import type { IprsPerson } from './iprs-person.js';
import { nationalIdSchema } from './iprs-person.js';
import { IprsLookupService } from './iprs-lookup.service.js';

/** Internal: not routed by the public entrypoint. Callers are services with the iprs scope. */
@ApiTags('internal')
@ApiBearerAuth()
@RequireScopes('iprs')
@Controller('internal/v1/iprs')
export class IprsController {
  constructor(private readonly iprs: IprsLookupService) {}

  @Get('persons/:nationalId')
  @ApiOperation({
    operationId: 'lookupIprsPerson',
    summary: 'Person as held by IPRS, cached for 24 hours (hits and misses)',
  })
  @ApiOkResponse({ description: 'Person found' })
  async lookupPerson(
    @Param('nationalId', new ZodValidationPipe(nationalIdSchema)) nationalId: string,
    @CurrentPrincipal() caller: Principal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<IprsPerson> {
    const result = await this.iprs.lookup(nationalId, caller);
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
