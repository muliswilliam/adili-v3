/**
 * The integration-gateway's uniform verification results for the four registries the declarant
 * can check (spec 05b), as `packages/schemas/internal/integration-gateway.yaml` defines them
 * (`ResultEnvelope`, `KraResult`, `NtsaResult`, `BrsResult`, `ArdhisasaResult`).
 *
 * This is a hand copy of `integration-gateway.yaml`: keep it in step with the YAML until it is
 * replaced by a generated client in `packages/clients`, with Zod validation of the gateway's
 * responses at the boundary (ADR-0013).
 */

export type LookupOutcome = 'found' | 'not-found' | 'unavailable';

export type UnavailableReason = 'timeout' | 'breaker-open' | 'paused' | 'upstream-error';

interface ResultEnvelope<TSystem extends RegistrySystem> {
  resultId: string;
  system: TSystem;
  outcome: LookupOutcome;
  reason: UnavailableReason | null;
  cached: boolean;
  /** ISO date-time the registry answered (or the cached answer's time). */
  checkedAt: string;
}

export interface KraTaxpayer {
  pin: string;
  registeredOn: string;
  compliance: {
    status: 'compliant' | 'non-compliant' | 'unknown';
    certificateNumber: string | null;
    validUntil: string | null;
    annualIncomeDeclaredCents: number | null;
  };
}

export interface KraResult extends ResultEnvelope<'kra'> {
  taxpayers: KraTaxpayer[];
}

export interface NtsaVehicle {
  registrationNumber: string;
  make: string;
  model: string;
  yearOfManufacture: number;
  registeredOn: string;
}

export interface NtsaResult extends ResultEnvelope<'ntsa'> {
  vehicles: NtsaVehicle[];
}

export interface BrsDirectorship {
  companyRegistrationNumber: string;
  companyName: string;
  companyStatus: string;
  role: string;
  shares: number | null;
  appointedOn: string;
}

export interface BrsResult extends ResultEnvelope<'brs'> {
  directorships: BrsDirectorship[];
}

export interface ArdhisasaParcel {
  parcelNumber: string;
  county: string;
  areaHectares: number;
  tenure: string;
  registeredOn: string;
}

export interface ArdhisasaResult extends ResultEnvelope<'ardhisasa'> {
  parcels: ArdhisasaParcel[];
}

export type RegistrySystem = 'kra' | 'ntsa' | 'brs' | 'ardhisasa';

export type RegistryResult = KraResult | NtsaResult | BrsResult | ArdhisasaResult;
