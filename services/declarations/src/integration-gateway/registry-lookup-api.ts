// Follows the gateway contract in #461 (spec 07b); regenerate when it merges.
//
// The registry lookups as the integration-gateway serves them once spec 07b's adapters land
// (#183 in #461): one POST per registry, the national ID in the body rather than the URL. Until
// then, packages/schemas/internal/integration-gateway.yaml (and so integration-gateway-api.gen.ts)
// still has the drafted GET routes, so these four operations are typed here by hand, in the shape
// openapi-typescript generates. When #461 merges: run `pnpm generate:api`, import `paths` from
// integration-gateway-api.gen.ts in http-integration-gateway-client.ts, delete this file, and take
// `REGISTRY_SCOPE` from @adili/roles.
import type { components } from './integration-gateway-api.gen.js';

type Schemas = components['schemas'];

/** The service token scope every registry lookup requires (#461's `REGISTRY_SCOPE`). */
export const REGISTRY_SCOPE = 'registry';

interface LookupHeaders {
  /** The Commission the lookup is for; the stored result is encrypted under it. */
  'X-Acting-Tenant': string;
  /** Why the registry is consulted, recorded on the result and the audit event. */
  'X-Legal-Basis': string;
  /** Recorded on the result and the audit event: here, the declaration. */
  'X-Case-Ref'?: string;
  /** The platform person the lookup is about, so reads of the result are audited as theirs. */
  'X-Subject-Person'?: string;
}

interface RegistryLookupBody {
  nationalId: string;
}

interface Problem {
  headers: Record<string, unknown>;
  content: { 'application/problem+json': Schemas['ProblemDetails'] };
}

interface LookupOperation<TResult> {
  parameters: {
    query?: never;
    header: LookupHeaders;
    path?: never;
    cookie?: never;
  };
  get?: never;
  put?: never;
  post: {
    parameters: {
      query?: never;
      header: LookupHeaders;
      path?: never;
      cookie?: never;
    };
    requestBody: { content: { 'application/json': RegistryLookupBody } };
    responses: {
      200: { headers: Record<string, unknown>; content: { 'application/json': TResult } };
      /** Legal basis missing or unknown, or a header malformed. */
      400: Problem;
      /** The token lacks `registry`. */
      403: Problem;
      /** `lookup-not-recorded`: the lookup could not be audited, so no answer; retry. */
      503: Problem;
    };
  };
  delete?: never;
  options?: never;
  head?: never;
  patch?: never;
  trace?: never;
}

/** The four lookups, as `paths` for `createServiceClient`. */
export interface RegistryLookupPaths {
  '/internal/v1/kra/taxpayer-lookups': LookupOperation<Schemas['KraResult']>;
  '/internal/v1/ntsa/vehicle-lookups': LookupOperation<Schemas['NtsaResult']>;
  '/internal/v1/brs/directorship-lookups': LookupOperation<Schemas['BrsResult']>;
  '/internal/v1/ardhisasa/parcel-lookups': LookupOperation<Schemas['ArdhisasaResult']>;
}
