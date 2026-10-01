import type { components } from './integration-gateway-api.gen.js';

type Schemas = components['schemas'];

/** integration-gateway.yaml `PayrollAction`. */
export type PayrollAction = 'stop_salary' | 'resume_salary';

/**
 * A stop or resume salary instruction (integration-gateway.yaml `PayrollInstructionRequest`).
 * Personal data: it travels to the gateway only, never into logs, events or workflow history.
 */
export interface PayrollInstructionRequest {
  /** The `ADM` reference (stop), or it with `-R` (resume): payroll is idempotent by it. */
  instructionReference: string;
  employerCode: string;
  personalNumber: string;
  nationalId: string;
  action: PayrollAction;
  reason: string;
  /** `YYYY-MM-DD`. */
  effectiveDate: string;
}

/** integration-gateway.yaml `PayrollInstruction`: the instruction as payroll acknowledged it. */
export interface PayrollInstruction {
  instructionReference: string;
  action: PayrollAction;
  status: 'accepted' | 'pending' | 'failed';
  payrollReference: string | null;
  receivedAt: string | null;
  sentAt: string;
}

/** On whose behalf an instruction is sent: the Commission, and the review case when there is one. */
export interface PayrollContext {
  tenant: string;
  caseRef?: string;
}

/** integration-gateway.yaml lookup results, as the gateway answers them. */
export type KraResult = Schemas['KraResult'];
export type NtsaResult = Schemas['NtsaResult'];
export type BrsResult = Schemas['BrsResult'];
export type ArdhisasaResult = Schemas['ArdhisasaResult'];
export type SupplierCheckResult = Schemas['SupplierCheckResult'];
/** integration-gateway.yaml `StoredResult`: a lookup's records read back by its result id. */
export type StoredResult = Schemas['StoredResult'];

/** The registries the review service cross-checks declarations against (spec 07b). */
export interface RegistryResults {
  kra: KraResult;
  ntsa: NtsaResult;
  brs: BrsResult;
  ardhisasa: ArdhisasaResult;
}
export type LookupSystem = keyof RegistryResults;

/**
 * Why a registry is consulted (integration-gateway.yaml `LegalBasis`): comparing a declaration
 * with other sources (Regs r.20(1)(b)) or verifying it (Act s.35(5)).
 */
export type RegistryLegalBasis = 'regs-r20-1-b' | 'act-s35-5';

/** On whose behalf, why and for which case a registry is consulted; recorded by the gateway. */
export interface RegistryContext {
  /** The Commission: the gateway stores the answer encrypted under its key. */
  tenant: string;
  legalBasis: RegistryLegalBasis;
  /** The review case the lookup is for. */
  caseRef: string;
  /**
   * The case's declarant: the gateway records it on the result, so each read of the stored
   * result is audited as a read of their data (ADR-008).
   */
  subjectPersonId: string;
}

/**
 * The integration-gateway (or payroll behind it) is unreachable, answered 503 or outside its
 * contract: nothing is recorded as sent, and activities retry with backoff. For a registry
 * lookup, also a lookup the gateway could not record (503 `lookup-not-recorded`): retried, as the
 * answer is cached.
 */
export class IntegrationGatewayUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IntegrationGatewayUnavailable';
  }
}

/**
 * What the review service asks of the integration-gateway's internal API, one synchronous hop per
 * call (ADR-013). A Nest token: the service uses `HttpIntegrationGatewayClient`, tests a fake.
 */
export abstract class IntegrationGatewayClient {
  /**
   * `submitPayrollInstruction`: sends the instruction to payroll and answers its acknowledgement.
   * Idempotent by instruction reference: a replay answers the stored acknowledgement and sends
   * nothing twice. Throws `IntegrationGatewayUnavailable` when payroll cannot be reached and
   * `InternalApiRejected` when the gateway refuses the request.
   */
  abstract submitPayrollInstruction(
    instruction: PayrollInstructionRequest,
    context: PayrollContext,
  ): Promise<PayrollInstruction>;

  /**
   * `lookupKraTaxpayer`, `lookupNtsaVehicles`, `lookupBrsDirectorships` or
   * `lookupArdhisasaParcels`: the registry's records of a national ID. A registry that gives no
   * answer is outcome `unavailable` with a reason, not an error. Throws
   * `IntegrationGatewayUnavailable` when the gateway cannot be reached or did not record the
   * lookup, and `InternalApiRejected` when it refuses the request.
   */
  abstract lookupRegistry<S extends LookupSystem>(
    system: S,
    nationalId: string,
    context: RegistryContext,
  ): Promise<RegistryResults[S]>;

  /**
   * `checkCompanySuppliesEmployer`: whether the company is on the employer's supplier list.
   * Errors as `lookupRegistry`.
   */
  abstract checkSupplier(
    registrationNumber: string,
    employerCode: string,
    context: RegistryContext,
  ): Promise<SupplierCheckResult>;

  /**
   * `getVerificationResult`: a stored lookup with its records, decrypted for the Commission; null
   * when the gateway has no such result for it. Throws `IntegrationGatewayUnavailable` when the
   * gateway cannot be reached or cannot decrypt now.
   */
  abstract getStoredResult(resultId: string, tenant: string): Promise<StoredResult | null>;

  /**
   * `getRegistryRateLimits`: the calls per minute the gateway sends each system (by the
   * gateway's system names, `hr-suppliers` among them), for pacing batch work under them. Throws
   * `IntegrationGatewayUnavailable` when the gateway cannot be reached.
   */
  abstract getRegistryRateLimits(): Promise<Record<string, number>>;
}
