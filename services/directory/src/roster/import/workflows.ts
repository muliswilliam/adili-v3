/**
 * Workflows hosted by the directory's worker. This module is bundled into Temporal's
 * deterministic sandbox: import only `@temporalio/workflow` and types.
 */
import {
  ActivityFailure,
  ApplicationFailure,
  continueAsNew,
  proxyActivities,
} from '@temporalio/workflow';

import type { RosterImportActivities } from './activities.js';
import {
  type ImportFailure,
  type ImportRef,
  type ImportResult,
  STORAGE_ERROR,
} from './workflow-contract.js';

/** Chunks applied per run before continuing as new, which keeps each run's history short. */
export const CHUNKS_PER_RUN = 200;

/** Activity retries (spec #27): three attempts with backoff, then the import fails. */
const THREE_ATTEMPTS = {
  maximumAttempts: 3,
  initialInterval: '1 second',
  backoffCoefficient: 2,
} as const;

// Timeouts bound how long a worker crash stalls the import before the attempt is retried.
const { stage } = proxyActivities<RosterImportActivities>({
  // A million rows take minutes; a crashed attempt is noticed by its missing heartbeats.
  startToCloseTimeout: '30 minutes',
  heartbeatTimeout: '30 seconds',
  retry: THREE_ATTEMPTS,
});

const { applyChunk } = proxyActivities<RosterImportActivities>({
  // A chunk takes well under a second.
  startToCloseTimeout: '30 seconds',
  retry: THREE_ATTEMPTS,
});

// Retried until it succeeds: an import that never ends would block the tenant's next import.
const { finalise } = proxyActivities<RosterImportActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '1 minute' },
});

export interface RosterImportInput extends ImportRef {
  /** Set when continuing as new: the staged plan and the next chunk to apply. */
  resume?: { chunkCount: number; declaredComplete: boolean; nextChunk: number };
}

/** How the import ended; `ended` when it had already ended or never existed. */
export type RosterImportOutcome = ImportResult['state'] | 'ended';

/**
 * `RosterImportWorkflow` (spec #27), started by the directory with the import id as workflow
 * id: stage the rows, apply the accepted ones chunk by chunk in order, then finalise. An
 * activity that exhausts its retries fails the import; chunks already applied stay applied and
 * the import keeps its processed count.
 */
export async function rosterImport(input: RosterImportInput): Promise<RosterImportOutcome> {
  const ref: ImportRef = { importId: input.importId, tenant: input.tenant };

  let plan = input.resume;
  if (!plan) {
    let staged;
    try {
      staged = await stage(ref);
    } catch (error) {
      return end(ref, { state: 'failed', failure: stagingFailure(error) });
    }
    if (staged.outcome === 'ended') return 'ended';
    if (staged.outcome === 'failed') return end(ref, { state: 'failed', failure: staged.failure });
    plan = {
      chunkCount: staged.chunkCount,
      declaredComplete: staged.declaredComplete,
      nextChunk: 0,
    };
  }

  const runEnd = plan.nextChunk + CHUNKS_PER_RUN;
  for (let chunk = plan.nextChunk; chunk < plan.chunkCount; chunk += 1) {
    if (chunk === runEnd) {
      return continueAsNew<typeof rosterImport>({ ...ref, resume: { ...plan, nextChunk: chunk } });
    }
    try {
      await applyChunk(ref, chunk);
    } catch {
      return end(ref, {
        state: 'failed',
        failure: {
          code: 'internal',
          detail: 'Rows could not be applied. Rows already applied are kept.',
        },
      });
    }
  }

  return end(ref, { state: 'completed' });
}

async function end(ref: ImportRef, result: ImportResult): Promise<RosterImportOutcome> {
  await finalise(ref, result);
  return result.state;
}

function stagingFailure(error: unknown): ImportFailure {
  const cause = error instanceof ActivityFailure ? error.cause : undefined;
  if (cause instanceof ApplicationFailure && cause.type === STORAGE_ERROR) {
    return { code: 'storage-error', detail: 'The file could not be read from storage.' };
  }
  return { code: 'internal', detail: 'The file could not be staged.' };
}
