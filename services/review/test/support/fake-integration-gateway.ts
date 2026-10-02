import { randomUUID } from 'node:crypto';

import {
  IntegrationGatewayClient,
  IntegrationGatewayUnavailable,
  type LookupSystem,
  type PayrollContext,
  type PayrollInstruction,
  type PayrollInstructionRequest,
  type RegistryContext,
  type RegistryResults,
  type StoredResult,
  type SupplierCheckResult,
} from '../../src/integration-gateway/integration-gateway-client.js';
import { InternalApiRejected } from '../../src/internal-api/rejected.js';
import type { RegistryRecords } from '../../src/rules/index.js';

/** An instruction as the fake payroll holds it: what was sent, for whom, and its acknowledgement. */
export interface StoredInstruction {
  request: PayrollInstructionRequest;
  context: PayrollContext;
  acknowledgement: PayrollInstruction;
}

/** What a registry holds about one national ID; a registry left out holds nothing on them. */
export type RegistryPerson = Partial<RegistryRecords>;

/** The gateway's systems the fake answers for: the registries and HR's supplier lists. */
export type FakeSystem = LookupSystem | 'hr-suppliers';

/** A lookup the fake gateway recorded, as its verification-results row would hold it. */
export interface RecordedLookup {
  resultId: string;
  system: FakeSystem;
  operation: 'lookup' | 'supplies';
  /** Whom it was about: the national ID, or `<employer code>:<registration number>`. */
  subject: string;
  outcome: 'found' | 'not-found' | 'unavailable';
  context: RegistryContext;
  payload: Record<string, unknown> | null;
  checkedAt: string;
}

/**
 * How a registry fails: answered `unavailable` with a reason, the gateway not answering, or the
 * gateway refusing the request (403: the token lacks the scope, say).
 */
export type RegistryFailure =
  | {
      kind: 'unavailable';
      reason: 'timeout' | 'breaker-open' | 'paused' | 'rate-limited' | 'upstream-error';
    }
  | { kind: 'gateway-down' }
  | { kind: 'refused' };

/** Calls per minute per system, as the gateway's .env.example configures them. */
const DEFAULT_RATE_LIMITS: Record<string, number> = {
  iprs: 1_200,
  kra: 60,
  ntsa: 60,
  brs: 60,
  ardhisasa: 60,
  'hr-suppliers': 60,
};

/**
 * The integration-gateway's payroll instructions for tests, behaving as the payroll mock does:
 * one instruction per reference (a resubmission answers the stored acknowledgement and stores
 * nothing), every call recorded. `failCalls` makes the next calls fail as a payroll outage would
 * (nothing stored); `loseResponses` stores the next instructions but fails the calls, as a timeout
 * after payroll accepted would.
 */
export class FakeIntegrationGateway extends IntegrationGatewayClient {
  /** Every call, in order, including replays and failed ones. */
  readonly calls: { request: PayrollInstructionRequest; context: PayrollContext }[] = [];
  private readonly stored = new Map<string, StoredInstruction>();
  private failures = 0;
  private lost = 0;
  private now: () => Date = () => new Date();

  /** Every registry lookup and supplier check, answered or not, in order. */
  readonly lookups: RecordedLookup[] = [];
  /** Every stored result read, by result id and tenant. */
  readonly storedReads: { resultId: string; tenant: string; actingSubject: string }[] = [];
  private readonly registry = new Map<string, RegistryPerson>();
  private readonly supplierLists = new Map<string, Set<string>>();
  private readonly failing = new Map<FakeSystem, { failure: RegistryFailure; times: number }>();
  private storedResultsDown = false;
  private storedResultsRefused = false;
  private rateLimits: Record<string, number> = { ...DEFAULT_RATE_LIMITS };

  /** The instructions payroll holds, in the order it received them. */
  get instructions(): StoredInstruction[] {
    return [...this.stored.values()];
  }

  /** The next `count` calls fail (payroll unavailable); nothing is stored. */
  failCalls(count: number): void {
    this.failures = count;
  }

  /** The next `count` new instructions are stored, but their calls fail (a lost response). */
  loseResponses(count: number): void {
    this.lost = count;
  }

  /** When payroll receives instructions (the service clock, in tests that set it). */
  receiveAt(now: () => Date): void {
    this.now = now;
  }

  /** What the registries hold about a national ID (the seed's records, say). */
  givenRegistryPerson(nationalId: string, person: RegistryPerson): void {
    this.registry.set(nationalId, structuredClone(person));
  }

  /** The companies on an employer's supplier list (the HR mock's), by registration number. */
  givenSuppliers(employerCode: string, registrationNumbers: string[]): void {
    this.supplierLists.set(employerCode, new Set(registrationNumbers));
  }

  /**
   * The next `times` lookups of `system` (supplier checks are `hr-suppliers`, as on the gateway)
   * fail as `failure` says; `Infinity` keeps it failing.
   */
  failRegistry(system: FakeSystem, failure: RegistryFailure, times = Infinity): void {
    this.failing.set(system, { failure, times });
  }

  /** Stored results cannot be read (the gateway or its key service is down) until said again. */
  failStoredResults(down = true): void {
    this.storedResultsDown = down;
  }

  /** Stored result reads are refused with 403 (the token lacks the scope) until said again. */
  /** The rate limits the gateway gives, per system (the test app's defaults otherwise). */
  givenRateLimits(limits: Record<string, number>): void {
    this.rateLimits = { ...DEFAULT_RATE_LIMITS, ...limits };
  }

  getRegistryRateLimits(): Promise<Record<string, number>> {
    return Promise.resolve({ ...this.rateLimits });
  }

  refuseStoredResults(refused = true): void {
    this.storedResultsRefused = refused;
  }

  reset(): void {
    this.calls.length = 0;
    this.stored.clear();
    this.failures = 0;
    this.lost = 0;
    this.now = () => new Date();
    this.lookups.length = 0;
    this.storedReads.length = 0;
    this.registry.clear();
    this.supplierLists.clear();
    this.failing.clear();
    this.storedResultsDown = false;
    this.storedResultsRefused = false;
    this.rateLimits = { ...DEFAULT_RATE_LIMITS };
  }

  lookupRegistry<S extends LookupSystem>(
    system: S,
    nationalId: string,
    context: RegistryContext,
  ): Promise<RegistryResults[S]> {
    const person = this.registry.get(nationalId) ?? {};
    const records = structuredClone(person[system] ?? EMPTY[system]);
    // KRA has no PIN for an ID it does not know; the other registries list nothing for it.
    const found = system !== 'kra' || (records as RegistryRecords['kra']).taxpayers.length > 0;
    return this.answer(
      system,
      'lookup',
      nationalId,
      context,
      found ? records : null,
      EMPTY[system],
    ) as Promise<RegistryResults[S]>;
  }

  checkSupplier(
    registrationNumber: string,
    employerCode: string,
    context: RegistryContext,
  ): Promise<SupplierCheckResult> {
    const supplies = this.supplierLists.get(employerCode)?.has(registrationNumber) ?? false;
    return this.answer(
      'hr-suppliers',
      'supplies',
      `${employerCode}:${registrationNumber}`,
      context,
      { supplies },
      { supplies: null },
    ) as Promise<SupplierCheckResult>;
  }

  getStoredResult(
    resultId: string,
    tenant: string,
    actingSubject: string,
  ): Promise<StoredResult | null> {
    this.storedReads.push({ resultId, tenant, actingSubject });
    if (this.storedResultsDown) {
      return Promise.reject(new IntegrationGatewayUnavailable('The key service is unavailable'));
    }
    if (this.storedResultsRefused) {
      return Promise.reject(new InternalApiRejected('integration-gateway', 403));
    }
    const lookup = this.lookups.find((entry) => entry.resultId === resultId);
    // Another Commission's result is as good as none.
    if (lookup?.context.tenant !== tenant) return Promise.resolve(null);
    return Promise.resolve({
      resultId,
      system: lookup.system,
      outcome: lookup.outcome,
      checkedAt: lookup.checkedAt,
      legalBasis: lookup.context.legalBasis,
      caseRef: lookup.context.caseRef,
      payload: structuredClone(lookup.payload),
    });
  }

  /** Records the lookup and answers it, failing as `failRegistry` set. */
  private answer(
    system: FakeSystem,
    operation: RecordedLookup['operation'],
    subject: string,
    context: RegistryContext,
    payload: Record<string, unknown> | null,
    empty: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const failing = this.failing.get(system);
    const failure = failing && failing.times > 0 ? failing.failure : null;
    if (failing && failure) failing.times -= 1;
    if (failure?.kind === 'gateway-down') {
      return Promise.reject(new IntegrationGatewayUnavailable('The gateway is unreachable'));
    }
    if (failure?.kind === 'refused') {
      return Promise.reject(new InternalApiRejected('integration-gateway', 403));
    }
    const outcome = failure ? 'unavailable' : payload ? 'found' : 'not-found';
    const recorded: RecordedLookup = {
      resultId: randomUUID(),
      system,
      operation,
      subject,
      outcome,
      context: { ...context },
      payload: outcome === 'found' ? structuredClone(payload) : null,
      checkedAt: this.now().toISOString(),
    };
    this.lookups.push(recorded);
    return Promise.resolve({
      resultId: recorded.resultId,
      system,
      outcome,
      reason: failure?.kind === 'unavailable' ? failure.reason : null,
      cached: false,
      checkedAt: recorded.checkedAt,
      ...(outcome === 'found' ? payload : empty),
    });
  }

  submitPayrollInstruction(
    request: PayrollInstructionRequest,
    context: PayrollContext,
  ): Promise<PayrollInstruction> {
    this.calls.push({ request: structuredClone(request), context: { ...context } });
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new IntegrationGatewayUnavailable('Payroll is unavailable'));
    }
    const replayed = this.stored.get(request.instructionReference);
    if (replayed) return Promise.resolve(structuredClone(replayed.acknowledgement));
    const at = this.now().toISOString();
    const acknowledgement: PayrollInstruction = {
      instructionReference: request.instructionReference,
      action: request.action,
      status: 'accepted',
      payrollReference: randomUUID(),
      receivedAt: at,
      sentAt: at,
    };
    this.stored.set(request.instructionReference, {
      request: structuredClone(request),
      context: { ...context },
      acknowledgement,
    });
    if (this.lost > 0) {
      this.lost -= 1;
      return Promise.reject(new IntegrationGatewayUnavailable('Payroll timed out'));
    }
    return Promise.resolve(structuredClone(acknowledgement));
  }
}

const EMPTY: RegistryRecords = {
  kra: { taxpayers: [] },
  ntsa: { vehicles: [] },
  brs: { directorships: [] },
  ardhisasa: { parcels: [] },
};
