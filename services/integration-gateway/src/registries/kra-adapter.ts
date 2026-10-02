import { Inject, Injectable } from '@nestjs/common';

import type { RegistryAdapter, UpstreamCalls } from '../adapter-kit/registry-adapter.js';
import { getFromRegistry, segment } from './registry-http.js';
import {
  kraComplianceSchema,
  kraPinsSchema,
  type KraTaxpayers,
  kraTaxpayersSchema,
} from './registry-records.js';
import { REGISTRY_URLS, type RegistryUrls } from './registry-urls.js';

/** The compliance of a PIN KRA listed but holds no compliance record for. */
const NO_COMPLIANCE: KraTaxpayers['taxpayers'][number]['compliance'] = {
  status: 'unknown',
  certificateNumber: null,
  validUntil: null,
  annualIncomeDeclaredCents: null,
};

/**
 * KRA (external/kra.yaml): the PINs of a national ID (`findTaxpayersByIdNumber`), then each
 * PIN's compliance and declared annual income (`getTaxCompliance`), all within the one timeout
 * the kit gives the lookup. Each compliance call takes a rate-limit slot of its own, so a lookup
 * spends 1 + one per PIN of KRA's limit. No PIN is not found.
 */
@Injectable()
export class KraAdapter implements RegistryAdapter<KraTaxpayers> {
  readonly system = 'kra';
  readonly operation = 'taxpayers';
  readonly schema = kraTaxpayersSchema;

  constructor(@Inject(REGISTRY_URLS) private readonly urls: RegistryUrls) {}

  async fetch(
    nationalId: string,
    signal: AbortSignal,
    calls: UpstreamCalls,
  ): Promise<KraTaxpayers | null> {
    const base = `${this.urls.kra}/v1/pins`;
    const pins = await getFromRegistry(
      'KRA',
      `${base}?id_number=${segment(nationalId)}`,
      kraPinsSchema,
      signal,
    );
    if (!pins || pins.length === 0) return null;
    const taxpayers = await Promise.all(
      pins.map(async ({ pin, registered_on }) => {
        await calls.another();
        const compliance = await getFromRegistry(
          'KRA',
          `${base}/${segment(pin)}/compliance`,
          kraComplianceSchema,
          signal,
          { notFound: null },
        );
        return { pin, registeredOn: registered_on, compliance: compliance ?? NO_COMPLIANCE };
      }),
    );
    return { taxpayers };
  }
}
