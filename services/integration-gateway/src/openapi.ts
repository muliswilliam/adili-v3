import type { z } from 'zod';

import { icmsReferralRequestSchema, icmsReferralSchema } from './icms/icms-records.js';
import { coverageSchema, systemCoverageSchema } from './integrations/coverage.js';
import { iprsPersonSchema, iprsResultSchema, lookupIprsPersonSchema } from './iprs/iprs-person.js';
import {
  payrollActionSchema,
  payrollInstructionRequestSchema,
  payrollInstructionSchema,
} from './payroll/payroll-records.js';
import { registryRateLimitsSchema } from './registries/rate-limits.controller.js';
import {
  ardhisasaResultSchema,
  brsResultSchema,
  kraResultSchema,
  lookupOutcomeSchema,
  ntsaResultSchema,
  registryLookupSchema,
  resultEnvelopeSchema,
  storedResultSchema,
  supplierCheckResultSchema,
  systemSchema,
  unavailableReasonSchema,
} from './registries/registry-records.js';

/**
 * Named schemas of the integration-gateway's OpenAPI document (`#/components/schemas/<name>`).
 */
export const OPENAPI_SCHEMAS: Record<string, z.ZodType> = {
  LookupIprsPerson: lookupIprsPersonSchema,
  IprsPerson: iprsPersonSchema,
  System: systemSchema,
  LookupOutcome: lookupOutcomeSchema,
  UnavailableReason: unavailableReasonSchema,
  RegistryLookup: registryLookupSchema,
  ResultEnvelope: resultEnvelopeSchema,
  KraResult: kraResultSchema,
  NtsaResult: ntsaResultSchema,
  BrsResult: brsResultSchema,
  ArdhisasaResult: ardhisasaResultSchema,
  IprsResult: iprsResultSchema,
  SupplierCheckResult: supplierCheckResultSchema,
  StoredResult: storedResultSchema,
  SystemCoverage: systemCoverageSchema,
  Coverage: coverageSchema,
  RegistryRateLimits: registryRateLimitsSchema,
  PayrollAction: payrollActionSchema,
  PayrollInstructionRequest: payrollInstructionRequestSchema,
  PayrollInstruction: payrollInstructionSchema,
  IcmsReferralRequest: icmsReferralRequestSchema,
  IcmsReferral: icmsReferralSchema,
};
