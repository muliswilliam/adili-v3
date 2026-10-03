/**
 * What passes between the registry lookup workflow, its activities and the service that starts
 * it (spec 05b). Identifiers only: the national ID is resolved inside the activity and never
 * enters workflow history, nor do the registry's records.
 */
import type { PersonKey } from '@adili/forms';

import type { RegistrySystem } from '../registry-results.js';

export const REGISTRY_LOOKUPS_WORKFLOW = 'registryLookups';

/**
 * How often a registry that does not answer is asked, and the pauses between (07b's rule: retry
 * with backoff, then `unavailable`). Short, as the declarant is waiting: the gateway's breaker
 * and cache absorb an outage, and the declarant can check again.
 */
export const LOOKUP_ATTEMPTS = 3;
export const LOOKUP_RETRY_DELAYS_MS = [2_000, 4_000] as const;

/** The declaration and person a lookup request is for, as the activities need them. */
export interface LookupRef {
  tenant: string;
  declarationId: string;
  /** The declarant: activities read and write under their row-level security. */
  personId: string;
  subject: string;
  personKey: PersonKey;
}

/** One set of a lookup request: the registry answers it on its own. */
export interface SetRef extends LookupRef {
  setId: string;
}

/** One request's lookups: one set per registry, each answered on its own. */
export interface RegistryLookupsInput extends LookupRef {
  /** The consent the request recorded; also the workflow id's suffix. */
  consentId: string;
  sets: { setId: string; system: RegistrySystem }[];
}

/** One attempt at one registry. On the `final` one an unavailable registry is recorded as such. */
export interface LookupAttempt extends SetRef {
  system: RegistrySystem;
  final: boolean;
}

/** `recorded`: the set is settled (or gone); `retry`: the registry did not answer, ask again. */
export type LookupAttemptOutcome = 'recorded' | 'retry';

export function registryLookupsWorkflowId(consentId: string): string {
  return `registry-lookups-${consentId}`;
}

export const DOCUMENT_READING_WORKFLOW = 'documentReading';
/** Sent by the consumer of the gateway's `ai.job.*` events when the reading's job ended. */
export const READING_JOB_FINISHED_SIGNAL = 'readingJobFinished';

/**
 * How long a reading may stay `pending` before it counts as failed (`unavailable`), so the
 * declarant can ask again: the gateway's job takes up to four provider attempts with backoff, so
 * well under this.
 */
export const READING_TIMEOUT_MS = 15 * 60_000;
/** How often the workflow pulls the job when no event said it ended. */
export const READING_PULL_INTERVAL_MS = 60_000;

/**
 * An `extract-document` job and the declarant who asked for it, as the request's token named
 * them: the workflow's activities settle the job's sets under that person's row-level security
 * (ADR-018), so nothing about the person is taken from the gateway or its events.
 */
export interface ReadingRef {
  tenant: string;
  declarationId: string;
  personId: string;
  subject: string;
  jobId: string;
}

export interface DocumentReadingInput extends ReadingRef {
  /** `pg_current_xact_id()` of the transaction that recorded the job and started the workflow. */
  transactionId: string;
  /** From the start, after which the job's pending sets are failed. */
  timeoutMs: number;
}

/** What the first settling waits on: the transaction that recorded the job and started this. */
export interface ReadingSettle extends ReadingRef {
  /** `pg_current_xact_id()` of that transaction, while it may still be open; null once ended. */
  transactionId: string | null;
}

/**
 * `settled`: nothing waits for the job any more (settled, or its recording rolled back);
 * `pending`: it has not ended yet.
 */
export type ReadingOutcome = 'settled' | 'pending';

/** One workflow per declaration and job: an equal request served from the cache shares it. */
export function documentReadingWorkflowId(declarationId: string, jobId: string): string {
  return `document-reading-${declarationId}-${jobId}`;
}
