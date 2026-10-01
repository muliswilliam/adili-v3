import { Inject, Injectable } from '@nestjs/common';

import type { RegistryAdapter } from '../adapter-kit/registry-adapter.js';
import { UpstreamError } from '../adapter-kit/upstream-error.js';
import { type IprsPerson, iprsPersonSchema, registryPersonSchema } from './iprs-person.js';

export const IPRS_CLIENT_OPTIONS = Symbol('IPRS_CLIENT_OPTIONS');

export interface IprsClientOptions {
  /** Ends before `/v1`, e.g. `http://localhost:8000/iprs`. */
  baseUrl: string;
}

/**
 * The IPRS adapter (external/iprs.yaml `getPerson`), a person by national ID. Returns the person,
 * or null when IPRS has no record; anything else (network, 5xx, an unreadable body) is an
 * `UpstreamError`. No retries: onboarding is waiting, and the caller decides whether to try again.
 */
@Injectable()
export class IprsClient implements RegistryAdapter<IprsPerson> {
  readonly system = 'iprs';
  readonly operation = 'person';
  readonly schema = iprsPersonSchema;

  constructor(@Inject(IPRS_CLIENT_OPTIONS) private readonly options: IprsClientOptions) {}

  async fetch(nationalId: string, signal: AbortSignal): Promise<IprsPerson | null> {
    const url = `${this.options.baseUrl}/v1/persons/${encodeURIComponent(nationalId)}`;
    let response: Response;
    try {
      response = await fetch(url, { headers: { accept: 'application/json' }, signal });
    } catch (error) {
      throw new UpstreamError('upstream-error', 'IPRS could not be reached', { cause: error });
    }

    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new UpstreamError('upstream-error', `IPRS answered ${response.status}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new UpstreamError('upstream-error', 'IPRS sent an unreadable body', { cause: error });
    }
    const person = registryPersonSchema.safeParse(body);
    if (!person.success) {
      throw new UpstreamError('upstream-error', 'IPRS sent a person without the required fields');
    }
    return person.data;
  }
}
