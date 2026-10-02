import type { components } from '../integration-gateway/integration-gateway-api.gen.js';

/**
 * The integration-gateway's uniform verification results for the four registries the declarant
 * can check (spec 05b): the 200 bodies of `lookupKraTaxpayer`, `lookupNtsaVehicles`,
 * `lookupBrsDirectorships` and `lookupArdhisasaParcels`, each a `ResultEnvelope` with its
 * records. The types come from the generated contract (`integration-gateway-api.gen.ts`), so a
 * change to `integration-gateway.yaml` shows up here at typecheck. Each result's `system` is
 * narrowed to its registry so a `RegistryResult` can be told apart by it.
 *
 * `getVerificationResult` answers a `StoredResult` whose `payload` the contract leaves free-form;
 * the mapping works on the lookup responses, which carry the same `resultId`.
 */

type Schemas = components['schemas'];

/** The registries a declarant can check; the gateway's other systems are not suggestion sources. */
export type RegistrySystem = Extract<Schemas['System'], 'kra' | 'ntsa' | 'brs' | 'ardhisasa'>;

export type LookupOutcome = Schemas['LookupOutcome'];

type OfSystem<TResult extends { system: Schemas['System'] }, TSystem extends RegistrySystem> = Omit<
  TResult,
  'system'
> & { system: TSystem };

export type KraResult = OfSystem<Schemas['KraResult'], 'kra'>;
export type NtsaResult = OfSystem<Schemas['NtsaResult'], 'ntsa'>;
export type BrsResult = OfSystem<Schemas['BrsResult'], 'brs'>;
export type ArdhisasaResult = OfSystem<Schemas['ArdhisasaResult'], 'ardhisasa'>;

export type KraTaxpayer = KraResult['taxpayers'][number];
export type NtsaVehicle = NtsaResult['vehicles'][number];
/** One BRS record of the person in a company: a directorship, a shareholding, or both. */
export type BrsDirectorship = BrsResult['directorships'][number];
export type ArdhisasaParcel = ArdhisasaResult['parcels'][number];

export type RegistryResult = KraResult | NtsaResult | BrsResult | ArdhisasaResult;
