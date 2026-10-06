import { Inject, Injectable } from '@nestjs/common';

import type { RegistryAdapter } from '../adapter-kit/registry-adapter.js';
import { callUpstream } from '../adapter-kit/upstream-http.js';
import { type IprsPerson, iprsPersonSchema, registryPersonSchema } from './iprs-person.js';

export const IPRS_CLIENT_OPTIONS = Symbol('IPRS_CLIENT_OPTIONS');

export interface IprsClientOptions {
  /** Ends before `/v1`, e.g. `http://localhost:8000/iprs`. */
  baseUrl: string;
}

/**
 * The IPRS adapter (external/iprs.yaml `getPerson`), a person by national ID, over the kit's
 * `callUpstream` as every registry: the person, or null when IPRS has no record; its own rate
 * limit (429) is `rate-limited`, anything else (network, 5xx, a body that breaks the contract) is
 * `upstream-error`. No retries: onboarding is waiting, and the caller decides whether to try again.
 */
@Injectable()
export class IprsClient implements RegistryAdapter<IprsPerson> {
  readonly system = 'iprs';
  readonly operation = 'person';
  readonly schema = iprsPersonSchema;

  constructor(@Inject(IPRS_CLIENT_OPTIONS) private readonly options: IprsClientOptions) {}

  fetch(nationalId: string, signal: AbortSignal): Promise<IprsPerson | null> {
    const url = `${this.options.baseUrl}/v1/persons/${encodeURIComponent(nationalId)}`;
    return callUpstream({ name: 'IPRS', url, signal, notFound: null }, registryPersonSchema);
  }
}
