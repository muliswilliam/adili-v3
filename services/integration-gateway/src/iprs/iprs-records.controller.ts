import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, InternalApi, schemaRef, ZodValidationPipe } from '@adili/api-kit';
import { REGISTRY_SCOPE } from '@adili/roles';

import { CurrentLookupContext, LookupPurposeHeaders } from '../adapter-kit/lookup-purpose.js';
import type { LookupContext, LookupResult } from '../adapter-kit/registry-adapter.js';
import { RegistryLookups } from '../adapter-kit/registry-lookups.js';
import { toLookupResult } from '../registries/lookup-results.js';
import { type RegistryLookup, registryLookupSchema } from '../registries/registry-records.js';
import { IprsClient } from './iprs-client.js';
import type { IprsPerson } from './iprs-person.js';

/**
 * IPRS as a registry a declarant checks for their own particulars (#612, stories 2 and 4): a
 * lookup by national ID under a legal basis and case reference, recorded, cached and answered
 * like the KRA, NTSA, BRS and ArdhiSasa lookups (`RegistriesController`), never an error when
 * IPRS gives no answer. Onboarding's identity check (`IprsController`) stays its own route, with
 * its own scope. Internal: services with the `registry` scope, acting for the Commission whose
 * key encrypts the stored answer.
 */
@ApiTags('internal')
@ApiBearerAuth()
@InternalApi(REGISTRY_SCOPE)
@Controller('internal/v1/iprs')
export class IprsRecordsController {
  constructor(
    private readonly lookups: RegistryLookups,
    private readonly iprs: IprsClient,
  ) {}

  @Post('person-record-lookups')
  @HttpCode(HttpStatus.OK)
  @LookupPurposeHeaders({ caseRef: 'required' })
  @ApiOperation({
    operationId: 'lookupIprsPersonRecord',
    summary: 'The person IPRS holds for a national ID: names, date and place of birth, sex',
    description:
      "A read, posted so the national ID travels in the body rather than the URL (URLs end up in access logs, traces and problem details). Safe to repeat. Every lookup, answered or not, is recorded with its legal basis and case reference, the answer encrypted under the acting tenant, and emits registry.lookup.performed.v1. Answers (found and not found) are cached for 24 hours, shared with onboarding's lookup. An IPRS that gives no answer is outcome unavailable with a reason, never an error. not-found: IPRS has no person with the national ID. Requires a service token with scope `registry` acting for the Commission.",
  })
  @ApiBody({ required: true, schema: schemaRef('RegistryLookup') })
  @ApiOkResponse({ description: 'The lookup result', schema: schemaRef('IprsResult') })
  @ApiProblemResponse(
    HttpStatus.SERVICE_UNAVAILABLE,
    'Problem type `lookup-not-recorded`: the lookup could not be recorded (audit), so no answer is given; retry',
  )
  async lookupPersonRecord(
    @Body(new ZodValidationPipe(registryLookupSchema)) body: RegistryLookup,
    @CurrentLookupContext() context: LookupContext,
  ) {
    const result = await this.lookups.lookup(this.iprs, body.nationalId, context);
    return toLookupResult(this.iprs.system, personUnder(result), { person: null });
  }
}

/** A found answer's person under `person`, as `IprsResult` carries it. */
function personUnder(result: LookupResult<IprsPerson>): LookupResult<{ person: IprsPerson }> {
  return result.outcome === 'found' ? { ...result, data: { person: result.data } } : result;
}
