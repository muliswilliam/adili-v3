import { Injectable, Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';

import type { BuiltRelease, OpenDataReleaseInput, ReleaseManifest } from './contract.js';
import { NcrNotBuilt, OpenDataReleaseBuilder, ReconciliationFailed } from './release-builder.js';
import { OpenDataReleasePublisher, ReleaseNotInPreview } from './release-publisher.js';

/**
 * The activities of `OpenDataReleaseWorkflow`, hosted by the reporting worker. Every public
 * method is an activity named after it (keep helpers out of this class); each is safe to retry.
 * What a retry cannot mend fails by its error's name (contract.ts
 * `NON_RETRYABLE_RELEASE_FAILURES`); an outage, or an NCR approval not yet committed, propagates
 * and is retried.
 */
@Injectable()
export class OpenDataReleaseActivities {
  private readonly logger = new Logger(OpenDataReleaseActivities.name);

  constructor(
    private readonly builder: OpenDataReleaseBuilder,
    private readonly publisher: OpenDataReleasePublisher,
  ) {}

  /** Builds the release under its id as a preview, once: a retry finds the one built. */
  async buildRelease({ releaseId, fy, kind }: OpenDataReleaseInput): Promise<BuiltRelease> {
    try {
      const release = await this.builder.build({ fy, kind, builtBy: null, releaseId });
      return { version: release.version };
    } catch (error) {
      if (error instanceof ReconciliationFailed || error instanceof NcrNotBuilt) {
        this.logger.error(
          { releaseId, fy, kind, err: errorType(error), mismatches: mismatchesOf(error) },
          'The open-data release could not be built',
        );
      }
      throw error;
    }
  }

  /** Issues the release's manifest as a Public verifiable document, once. */
  issueReleaseManifest({ releaseId }: OpenDataReleaseInput): Promise<ReleaseManifest> {
    return this.publisher.issueManifest(releaseId, null);
  }

  /** Publishes the release on its NCR's approval; published already (a retry) is done. */
  async publishRelease({ releaseId }: OpenDataReleaseInput): Promise<void> {
    try {
      await this.publisher.publish(releaseId);
    } catch (error) {
      if (error instanceof ReleaseNotInPreview && error.status === 'published') return;
      throw error;
    }
  }
}

function mismatchesOf(error: Error): readonly string[] {
  return error instanceof ReconciliationFailed ? error.mismatches : [];
}
