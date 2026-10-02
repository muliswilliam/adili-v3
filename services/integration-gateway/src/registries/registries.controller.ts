import {
  applyDecorators,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ApiProblemResponse, InternalApi, schemaRef, ZodValidationPipe } from '@adili/api-kit';
import { REGISTRY_SCOPE } from '@adili/roles';

import { CurrentLookupContext, LookupPurposeHeaders } from '../adapter-kit/lookup-purpose.js';
import type { LookupContext, RegistryAdapter } from '../adapter-kit/registry-adapter.js';
import { RegistryLookups } from '../adapter-kit/registry-lookups.js';
import { ArdhisasaAdapter } from './ardhisasa-adapter.js';
import { BrsDirectorshipsAdapter, SupplierCheckAdapter } from './brs-adapters.js';
import { KraAdapter } from './kra-adapter.js';
import { toLookupResult } from './lookup-results.js';
import { NtsaAdapter } from './ntsa-adapter.js';
import {
  EMPLOYER_CODE,
  employerCodeSchema,
  REGISTRATION_NUMBER,
  registrationNumberSchema,
  type RegistryLookup,
  registryLookupSchema,
} from './registry-records.js';

const POSTED =
  'A read, posted so the national ID travels in the body rather than the URL (URLs end up in access logs, traces and problem details). Safe to repeat.';
const RECORDED =
  'Every lookup, answered or not, is recorded with its legal basis and case reference, the answer encrypted under the acting tenant, and emits registry.lookup.performed.v1. Answers (found and not found) are cached for 24 hours. A registry that gives no answer is outcome unavailable with a reason, never an error.';
const SCOPE = `Requires a service token with scope \`${REGISTRY_SCOPE}\` acting for the Commission.`;

const NOT_RECORDED =
  'Problem type `lookup-not-recorded`: the lookup could not be recorded (audit), so no answer is given; retry';

/** The registries looked up by national ID. */
type LookupSystem = 'kra' | 'ntsa' | 'brs' | 'ardhisasa';

/** How each lookup by national ID is routed, documented and answered when nothing is found. */
const LOOKUPS = {
  kra: {
    path: 'kra/taxpayer-lookups',
    operationId: 'lookupKraTaxpayer',
    summary: 'KRA PINs of a national ID, each with its compliance and declared annual income',
    found: 'not-found: KRA has no PIN for the national ID.',
    result: 'KraResult',
    empty: { taxpayers: [] },
  },
  ntsa: {
    path: 'ntsa/vehicle-lookups',
    operationId: 'lookupNtsaVehicles',
    summary: 'Vehicles registered to a national ID',
    found: 'No vehicles is found with none.',
    result: 'NtsaResult',
    empty: { vehicles: [] },
  },
  brs: {
    path: 'brs/directorship-lookups',
    operationId: 'lookupBrsDirectorships',
    summary: 'Directorships and shareholdings of a national ID',
    found: 'No companies is found with none.',
    result: 'BrsResult',
    empty: { directorships: [] },
  },
  ardhisasa: {
    path: 'ardhisasa/parcel-lookups',
    operationId: 'lookupArdhisasaParcels',
    summary: 'Land parcels registered to a national ID',
    found: 'No parcels is found with none.',
    result: 'ArdhisasaResult',
    empty: { parcels: [] },
  },
} as const satisfies Record<LookupSystem, unknown>;

/** The route of a lookup by national ID, from its row of `LOOKUPS`. */
const LookupRoute = (system: LookupSystem) => {
  const lookup = LOOKUPS[system];
  return applyDecorators(
    Post(lookup.path),
    HttpCode(HttpStatus.OK),
    LookupPurposeHeaders({ caseRef: 'required' }),
    ApiOperation({
      operationId: lookup.operationId,
      summary: lookup.summary,
      description: `${POSTED} ${RECORDED} ${lookup.found} ${SCOPE}`,
    }),
    ApiBody({ required: true, schema: schemaRef('RegistryLookup') }),
    ApiOkResponse({ description: 'The lookup result', schema: schemaRef(lookup.result) }),
    ApiProblemResponse(HttpStatus.SERVICE_UNAVAILABLE, NOT_RECORDED),
  );
};

const lookupBody = new ZodValidationPipe(registryLookupSchema);

/**
 * Registry lookups for the review service's cross-checks (spec 07b): KRA, NTSA, BRS and
 * ArdhiSasa by national ID (one row of `LOOKUPS` each, answered by `lookUp`), and the
 * employer-supplier check. Internal: services with the `registry` scope, acting for the
 * Commission whose key encrypts the stored answer.
 */
@ApiTags('internal')
@ApiBearerAuth()
@InternalApi(REGISTRY_SCOPE)
@Controller('internal/v1')
export class RegistriesController {
  private readonly adapters: Record<LookupSystem, RegistryAdapter<object>>;

  constructor(
    private readonly lookups: RegistryLookups,
    private readonly suppliers: SupplierCheckAdapter,
    kra: KraAdapter,
    ntsa: NtsaAdapter,
    brs: BrsDirectorshipsAdapter,
    ardhisasa: ArdhisasaAdapter,
  ) {
    this.adapters = { kra, ntsa, brs, ardhisasa };
  }

  @LookupRoute('kra')
  lookupKra(
    @Body(lookupBody) body: RegistryLookup,
    @CurrentLookupContext() context: LookupContext,
  ) {
    return this.lookUp('kra', body, context);
  }

  @LookupRoute('ntsa')
  lookupNtsa(
    @Body(lookupBody) body: RegistryLookup,
    @CurrentLookupContext() context: LookupContext,
  ) {
    return this.lookUp('ntsa', body, context);
  }

  @LookupRoute('brs')
  lookupBrs(
    @Body(lookupBody) body: RegistryLookup,
    @CurrentLookupContext() context: LookupContext,
  ) {
    return this.lookUp('brs', body, context);
  }

  @LookupRoute('ardhisasa')
  lookupArdhisasa(
    @Body(lookupBody) body: RegistryLookup,
    @CurrentLookupContext() context: LookupContext,
  ) {
    return this.lookUp('ardhisasa', body, context);
  }

  @Get('brs/companies/:registrationNumber/supplies')
  @LookupPurposeHeaders({ caseRef: 'required' })
  @ApiOperation({
    operationId: 'checkCompanySuppliesEmployer',
    summary: "Whether a company is on an employer's supplier list (HR), for the BRS check",
    description: `${RECORDED} Its own system, hr-suppliers (HR's supplier lists), with its own breaker, rate limit and pause. An employer HR does not know has no suppliers: false. ${SCOPE}`,
  })
  @ApiParam({
    name: 'registrationNumber',
    schema: { type: 'string', pattern: REGISTRATION_NUMBER.source },
  })
  @ApiQuery({
    name: 'employerCode',
    required: true,
    schema: { type: 'string', pattern: EMPLOYER_CODE.source },
  })
  @ApiOkResponse({ description: 'The check result', schema: schemaRef('SupplierCheckResult') })
  @ApiProblemResponse(HttpStatus.SERVICE_UNAVAILABLE, NOT_RECORDED)
  async checkSupplier(
    @Param('registrationNumber', new ZodValidationPipe(registrationNumberSchema))
    registrationNumber: string,
    @Query('employerCode', new ZodValidationPipe(employerCodeSchema)) employerCode: string,
    @CurrentLookupContext() context: LookupContext,
  ) {
    const subject = { employerCode, registrationNumber };
    const result = await this.lookups.lookup(this.suppliers, subject, context);
    return toLookupResult(this.suppliers.system, result, { supplies: null });
  }

  /** A lookup by national ID through the system's adapter, answered as the contract has it. */
  private async lookUp(system: LookupSystem, body: RegistryLookup, context: LookupContext) {
    const result = await this.lookups.lookup(this.adapters[system], body.nationalId, context);
    return toLookupResult(system, result, LOOKUPS[system].empty);
  }
}
