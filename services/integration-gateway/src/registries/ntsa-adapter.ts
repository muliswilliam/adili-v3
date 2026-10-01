import { Inject, Injectable } from '@nestjs/common';

import type { RegistryAdapter } from '../adapter-kit/registry-adapter.js';
import { getFromRegistry, segment } from './registry-http.js';
import {
  ntsaOwnerVehiclesSchema,
  type NtsaVehicles,
  ntsaVehiclesSchema,
} from './registry-records.js';
import { REGISTRY_URLS, type RegistryUrls } from './registry-urls.js';

/**
 * NTSA (external/ntsa.yaml `listVehiclesByOwner`): vehicles registered to a national ID. An owner
 * with none is a found answer with no vehicles, never not found.
 */
@Injectable()
export class NtsaAdapter implements RegistryAdapter<NtsaVehicles> {
  readonly system = 'ntsa';
  readonly operation = 'vehicles';
  readonly schema = ntsaVehiclesSchema;

  constructor(@Inject(REGISTRY_URLS) private readonly urls: RegistryUrls) {}

  fetch(nationalId: string, signal: AbortSignal): Promise<NtsaVehicles | null> {
    const url = `${this.urls.ntsa}/v1/owners/${segment(nationalId)}/vehicles`;
    return getFromRegistry('NTSA', url, ntsaOwnerVehiclesSchema, signal);
  }
}
