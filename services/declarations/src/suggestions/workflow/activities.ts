import { Injectable } from '@nestjs/common';

import { RegistryLookupSteps } from '../registry-lookup-steps.js';
import type { LookupAttempt, LookupAttemptOutcome, SetRef } from './contract.js';

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
