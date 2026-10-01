import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
  CurrentPrincipal,
  InternalApi,
  type Principal,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { REGISTRY_SCOPE } from '@adili/roles';

import { LookupPurposeHeaders, Purpose } from '../adapter-kit/lookup-purpose.js';
import type { LookupContext, LookupPurpose } from '../adapter-kit/registry-adapter.js';
import { RegistryLookups } from '../adapter-kit/registry-lookups.js';
import { ArdhisasaAdapter } from './ardhisasa-adapter.js';
import { BrsDirectorshipsAdapter, SupplierCheckAdapter, supplierSubject } from './brs-adapters.js';
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

/**
 * Registry lookups for the review service's cross-checks (spec 07b): KRA, NTSA, BRS and
 * ArdhiSasa by national ID, and the employer-supplier check. Internal: services with the
 * `registry` scope, acting for the Commission whose key encrypts the stored answer.
 */
@ApiTags('internal')
@ApiBearerAuth()
@InternalApi(REGISTRY_SCOPE)
@Controller('internal/v1')
export class RegistriesController {
  constructor(
    private readonly lookups: RegistryLookups,
    private readonly kra: KraAdapter,
    private readonly ntsa: NtsaAdapter,
    private readonly brs: BrsDirectorshipsAdapter,
    private readonly suppliers: SupplierCheckAdapter,
    private readonly ardhisasa: ArdhisasaAdapter,
  ) {}

  @Post('kra/taxpayer-lookups')
  @HttpCode(HttpStatus.OK)
  @LookupPurposeHeaders()
  @ApiOperation({
    operationId: 'lookupKraTaxpayer',
    summary: 'KRA PINs of a national ID, each with its compliance and declared annual income',
    description: `${POSTED} ${RECORDED} not-found: KRA has no PIN for the national ID. ${SCOPE}`,
  })
  @ApiBody({ required: true, schema: schemaRef('RegistryLookup') })
  @ApiOkResponse({ description: 'The lookup result', schema: schemaRef('KraResult') })
  @ApiProblemResponse(HttpStatus.SERVICE_UNAVAILABLE, NOT_RECORDED)
  async lookupKra(
    @Body(new ZodValidationPipe(registryLookupSchema)) body: RegistryLookup,
    @CurrentPrincipal() caller: Principal,
    @ActingTenant() tenant: string,
    @Purpose() purpose: LookupPurpose,
  ) {
    const context: LookupContext = { caller, purpose, tenant };
    const result = await this.lookups.lookup(this.kra, body.nationalId, context);
    return toLookupResult('kra', result, { taxpayers: [] });
  }

  @Post('ntsa/vehicle-lookups')
  @HttpCode(HttpStatus.OK)
  @LookupPurposeHeaders()
  @ApiOperation({
    operationId: 'lookupNtsaVehicles',
    summary: 'Vehicles registered to a national ID',
    description: `${POSTED} ${RECORDED} No vehicles is found with none. ${SCOPE}`,
  })
  @ApiBody({ required: true, schema: schemaRef('RegistryLookup') })
  @ApiOkResponse({ description: 'The lookup result', schema: schemaRef('NtsaResult') })
  @ApiProblemResponse(HttpStatus.SERVICE_UNAVAILABLE, NOT_RECORDED)
  async lookupNtsa(
    @Body(new ZodValidationPipe(registryLookupSchema)) body: RegistryLookup,
    @CurrentPrincipal() caller: Principal,
    @ActingTenant() tenant: string,
    @Purpose() purpose: LookupPurpose,
  ) {
    const context: LookupContext = { caller, purpose, tenant };
    const result = await this.lookups.lookup(this.ntsa, body.nationalId, context);
    return toLookupResult('ntsa', result, { vehicles: [] });
  }

  @Post('brs/directorship-lookups')
  @HttpCode(HttpStatus.OK)
  @LookupPurposeHeaders()
  @ApiOperation({
    operationId: 'lookupBrsDirectorships',
    summary: 'Directorships and shareholdings of a national ID',
    description: `${POSTED} ${RECORDED} No companies is found with none. ${SCOPE}`,
  })
  @ApiBody({ required: true, schema: schemaRef('RegistryLookup') })
  @ApiOkResponse({ description: 'The lookup result', schema: schemaRef('BrsResult') })
  @ApiProblemResponse(HttpStatus.SERVICE_UNAVAILABLE, NOT_RECORDED)
  async lookupBrs(
    @Body(new ZodValidationPipe(registryLookupSchema)) body: RegistryLookup,
    @CurrentPrincipal() caller: Principal,
    @ActingTenant() tenant: string,
    @Purpose() purpose: LookupPurpose,
  ) {
    const context: LookupContext = { caller, purpose, tenant };
    const result = await this.lookups.lookup(this.brs, body.nationalId, context);
    return toLookupResult('brs', result, { directorships: [] });
  }

  @Post('ardhisasa/parcel-lookups')
  @HttpCode(HttpStatus.OK)
  @LookupPurposeHeaders()
  @ApiOperation({
    operationId: 'lookupArdhisasaParcels',
    summary: 'Land parcels registered to a national ID',
    description: `${POSTED} ${RECORDED} No parcels is found with none. ${SCOPE}`,
  })
  @ApiBody({ required: true, schema: schemaRef('RegistryLookup') })
  @ApiOkResponse({ description: 'The lookup result', schema: schemaRef('ArdhisasaResult') })
  @ApiProblemResponse(HttpStatus.SERVICE_UNAVAILABLE, NOT_RECORDED)
  async lookupArdhisasa(
    @Body(new ZodValidationPipe(registryLookupSchema)) body: RegistryLookup,
    @CurrentPrincipal() caller: Principal,
    @ActingTenant() tenant: string,
    @Purpose() purpose: LookupPurpose,
  ) {
    const context: LookupContext = { caller, purpose, tenant };
    const result = await this.lookups.lookup(this.ardhisasa, body.nationalId, context);
    return toLookupResult('ardhisasa', result, { parcels: [] });
  }

  @Get('brs/companies/:registrationNumber/supplies')
  @LookupPurposeHeaders()
  @ApiOperation({
    operationId: 'checkCompanySuppliesEmployer',
    summary: "Whether a company is on an employer's supplier list (HR), for the BRS check",
    description: `${RECORDED} Filed under BRS. An employer HR does not know has no suppliers: false. ${SCOPE}`,
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
    registration: string,
    @Query('employerCode', new ZodValidationPipe(employerCodeSchema)) employer: string,
    @CurrentPrincipal() caller: Principal,
    @ActingTenant() tenant: string,
    @Purpose() purpose: LookupPurpose,
  ) {
    const context: LookupContext = { caller, purpose, tenant };
    const subject = supplierSubject(registration, employer);
    const result = await this.lookups.lookup(this.suppliers, subject, context);
    return toLookupResult('brs', result, { supplies: null });
  }
}
