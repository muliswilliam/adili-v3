import { Injectable } from '@nestjs/common';

import { DocumentReadingSteps } from '../document-reading-steps.js';
import { RegistryLookupSteps } from '../registry-lookup-steps.js';
import type {
  LookupAttempt,
  LookupAttemptOutcome,
  ReadingOutcome,
  ReadingRef,
  ReadingSettle,
  SetRef,
} from './contract.js';

/**
 * The activities of the registry lookup workflow, hosted by the declarations worker. Every public
 * method is an activity named after it (keep helpers out of this class, and names unique across
 * the worker's activities); each is safe to retry.
 */
@Injectable()
export class SuggestionActivities {
  constructor(private readonly steps: RegistryLookupSteps) {}

  /**
   * One attempt at one registry: `retry` when it did not answer (and this is not the final
   * attempt), else the set is recorded `ready` with its suggestions, `unavailable` or `no-id`.
   */
  lookupRegistry(attempt: LookupAttempt): Promise<LookupAttemptOutcome> {
    return this.steps.lookup(attempt);
  }

  /** Records the set `failed`: the check could not run, whatever the registry. */
  markLookupFailed(ref: SetRef): Promise<void> {
    return this.steps.fail(ref);
  }
}

/**
 * The activities of the document reading workflow (spec 05b S6), hosted by the declarations
 * worker, named after their methods like the lookup's; each is safe to retry.
 */
@Injectable()
export class ReadingActivities {
  constructor(private readonly steps: DocumentReadingSteps) {}

  /**
   * Once the transaction that started the workflow has ended (retried while it is open), pulls
   * the job and, once it ended, records its reading or why there is none.
   */
  settleReading(ref: ReadingSettle): Promise<ReadingOutcome> {
    return this.steps.settle(ref);
  }

  /** Fails the job's sets still pending (`unavailable`): it took too long. */
  expireReading(ref: ReadingRef): Promise<void> {
    return this.steps.expire(ref);
  }
}
