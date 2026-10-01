import { Inject, Injectable } from '@nestjs/common';

import type { RegistryAdapter } from '../adapter-kit/registry-adapter.js';
import { getFromRegistry, segment } from './registry-http.js';
import {
  type ArdhisasaParcels,
  ardhisasaOwnerParcelsSchema,
  ardhisasaParcelsSchema,
} from './registry-records.js';
import { REGISTRY_URLS, type RegistryUrls } from './registry-urls.js';

/**
 * ArdhiSasa (external/ardhisasa.yaml `listParcelsByOwner`): parcels registered to a national ID.
 * An owner with none is a found answer with no parcels, never not found.
 */
@Injectable()
export class ArdhisasaAdapter implements RegistryAdapter<ArdhisasaParcels> {
  readonly system = 'ardhisasa';
  readonly operation = 'parcels';
  readonly schema = ardhisasaParcelsSchema;

  constructor(@Inject(REGISTRY_URLS) private readonly urls: RegistryUrls) {}

  fetch(nationalId: string, signal: AbortSignal): Promise<ArdhisasaParcels | null> {
    const url = `${this.urls.ardhisasa}/v1/owners/${segment(nationalId)}/parcels`;
    return getFromRegistry('ArdhiSasa', url, ardhisasaOwnerParcelsSchema, signal);
  }
}
