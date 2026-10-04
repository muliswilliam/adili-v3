import { Injectable, Module } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';
import { v5 as uuidv5 } from 'uuid';

import { startOnce } from '../workflow-start.js';
import {
  OPEN_DATA_RELEASE_WORKFLOW,
  type OpenDataReleaseInput,
  openDataReleaseWorkflowId,
} from './contract.js';
import type { openDataRelease } from './workflows.js';

/** Namespace of the annual release's id: one per national consolidated report. */
const ANNUAL_RELEASE_NAMESPACE = '8d2f6a41-3c7e-4b95-a0d8-e61b9c5f2734';

/** The id of the annual release published on the approval of the national report. */
export function annualReleaseIdOf(nationalReportId: string): string {
  return uuidv5(`${nationalReportId}:annual`, ANNUAL_RELEASE_NAMESPACE);
}

/** Starts `OpenDataReleaseWorkflow` on Temporal (ADR-003). */
@Injectable()
export class OpenDataReleaseWorkflows {
  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  /**
   * The year's national consolidated report was approved: starts the workflow that builds,
   * certifies and publishes its annual release. The release id comes from the report's, so a
   * retried approval starts nothing new.
   */
  async ncrApproved(input: {
    nationalReportId: string;
    fy: number;
  }): Promise<OpenDataReleaseInput> {
    const release: OpenDataReleaseInput = {
      releaseId: annualReleaseIdOf(input.nationalReportId),
      fy: input.fy,
      kind: 'annual',
    };
    await startOnce<typeof openDataRelease>(
      this.temporal,
      OPEN_DATA_RELEASE_WORKFLOW,
      openDataReleaseWorkflowId(release),
      [release],
    );
    return release;
  }
}

/** `OpenDataReleaseWorkflows` for the national-reports module, which starts it on approval. */
@Module({ providers: [OpenDataReleaseWorkflows], exports: [OpenDataReleaseWorkflows] })
export class OpenDataReleaseWorkflowsModule {}
