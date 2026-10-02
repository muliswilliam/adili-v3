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

/** The PINs, then one PIN's compliance. */
export const KRA_CALLS_PER_LOOKUP = 2;

/**
 * KRA lookups of one household the burst takes without queueing: the declarant's, then their
 * spouse's, the common household (children are rarely of an age to hold a national ID). A case's
 * registry check looks its people up one after the other, the spouse's well within the seconds
 * the declarant's slots take to free up at the slowest rate.
 */
export const KRA_HOUSEHOLD_LOOKUPS = 2;

/**
 * KRA's least burst: a household's consecutive lookups go out without queueing for the rate
 * limit, whatever the rate (at 60 a minute, one second's worth would be a single call). A third
 * person's lookup, another case's or one after a second PIN's charged call shares the bucket: it
 * queues up to the max wait, or is answered `rate-limited` and looked up again by the check's
 * retries.
 */
export const KRA_BURST = KRA_CALLS_PER_LOOKUP * KRA_HOUSEHOLD_LOOKUPS;

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
 * the kit gives the lookup. A lookup spends 1 + one per PIN of KRA's rate limit: the kit
 * reserves two (most IDs have one PIN), a second PIN's call is charged and, with no PIN, the
 * unused compliance slot returned. No PIN is not found.
 */
@Injectable()
export class KraAdapter implements RegistryAdapter<KraTaxpayers> {
  readonly system = 'kra';
  readonly operation = 'taxpayers';
  readonly schema = kraTaxpayersSchema;
  readonly callsPerLookup = KRA_CALLS_PER_LOOKUP;

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
    // The PINs' call, then one per PIN, against the calls the kit reserved.
    await calls.charge(1 + (pins?.length ?? 0) - KRA_CALLS_PER_LOOKUP);
    if (!pins || pins.length === 0) return null;
    const taxpayers = await Promise.all(
      pins.map(async ({ pin, registered_on }) => {
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
