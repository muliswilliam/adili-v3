/**
 * The registry lookup workflow (spec 05b), hosted by the declarations worker. Bundled into
 * Temporal's deterministic sandbox: import only `@temporalio/workflow`, types and pure modules.
 */
import { ActivityFailure, proxyActivities, sleep } from '@temporalio/workflow';

import type { SuggestionActivities } from './activities.js';
import {
  LOOKUP_ATTEMPTS,
  LOOKUP_RETRY_DELAYS_MS,
  type LookupRef,
  type RegistryLookupsInput,
} from './contract.js';

// One attempt at a registry: the gateway call and, once it answered, the write. A failure that is
// not the registry's (database, key service, directory) is retried, then the set is `failed`.
const { lookupRegistry } = proxyActivities<SuggestionActivities>({
  startToCloseTimeout: '1 minute',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumAttempts: 5 },
});

// Database work: retried until it succeeds, so a set is never left pending.
const { markLookupFailed } = proxyActivities<SuggestionActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '1 minute' },
});

/**
 * `RegistryLookupsWorkflow`, one per lookup request (workflow id `registry-lookups-<consentId>`):
 * asks each registry of the request in parallel, up to `LOOKUP_ATTEMPTS` times with a pause
 * between while it does not answer; the last attempt records it `unavailable`. Results are
 * written by the activity, so nothing a registry said passes through workflow history.
 */
export async function registryLookups(input: RegistryLookupsInput): Promise<void> {
  const ref: LookupRef = {
    tenant: input.tenant,
    declarationId: input.declarationId,
    personId: input.personId,
    subject: input.subject,
    personKey: input.personKey,
  };
  await Promise.all(
    input.sets.map(async ({ setId, system }) => {
      try {
        for (let attempt = 1; ; attempt += 1) {
          const final = attempt >= LOOKUP_ATTEMPTS;
          const outcome = await lookupRegistry({ ...ref, setId, system, final });
          if (outcome === 'recorded' || final) return;
          await sleep(LOOKUP_RETRY_DELAYS_MS[attempt - 1] ?? LOOKUP_RETRY_DELAYS_MS.at(-1) ?? 0);
        }
      } catch (error) {
        if (!(error instanceof ActivityFailure)) throw error;
        await markLookupFailed({ ...ref, setId });
      }
    }),
  );
}
