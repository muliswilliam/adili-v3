/**
 * The registry lookup and document reading workflows (spec 05b), hosted by the declarations worker. Bundled into
 * Temporal's deterministic sandbox: import only `@temporalio/workflow`, types and pure modules.
 */
import {
  ActivityFailure,
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow';

import type { ReadingActivities, SuggestionActivities } from './activities.js';
import {
  type DocumentReadingInput,
  LOOKUP_ATTEMPTS,
  LOOKUP_RETRY_DELAYS_MS,
  type LookupRef,
  READING_JOB_FINISHED_SIGNAL,
  READING_PULL_INTERVAL_MS,
  type ReadingRef,
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

// A reading's settling: the gateway's job read, and the sets written. Retried a few times; the
// workflow pulls again later should it still fail.
const { settleReading } = proxyActivities<ReadingActivities>({
  startToCloseTimeout: '1 minute',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumAttempts: 5 },
});

// Database work: retried until it succeeds, so a set is never left pending.
const { expireReading } = proxyActivities<ReadingActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '1 minute' },
});

export const readingJobFinished = defineSignal(READING_JOB_FINISHED_SIGNAL);

/**
 * `DocumentReadingWorkflow`, one per declaration and `extract-document` job (workflow id
 * `document-reading-<declarationId>-<jobId>`), started by the request with the declarant from
 * its token: settles the job's sets once it has ended, on the job's event (a signal) or by
 * pulling it every `READING_PULL_INTERVAL_MS` (which also covers an event that came before the
 * workflow started); past `timeoutMs` the sets still pending are failed
 * (`unavailable`), so the declarant can ask again.
 */
export async function documentReading(input: DocumentReadingInput): Promise<void> {
  const ref: ReadingRef = {
    tenant: input.tenant,
    declarationId: input.declarationId,
    personId: input.personId,
    subject: input.subject,
    jobId: input.jobId,
  };
  let ended = false;
  setHandler(readingJobFinished, () => {
    ended = true;
  });
  const deadline = Date.now() + input.timeoutMs;
  for (;;) {
    if (ended) {
      ended = false;
      try {
        if ((await settleReading(ref)) === 'settled') return;
      } catch (error) {
        if (!(error instanceof ActivityFailure)) throw error;
      }
    }
    const left = deadline - Date.now();
    if (left <= 0) break;
    if (!(await condition(() => ended, Math.min(left, READING_PULL_INTERVAL_MS)))) ended = true;
  }
  await expireReading(ref);
}
