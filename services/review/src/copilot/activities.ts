import { Injectable } from '@nestjs/common';

import { SYSTEM_SUBJECT } from '../system-context.js';
import type {
  CopilotActivityRequest,
  CopilotJobFinished,
  CopilotUnavailableReason,
  NotEnabledPage,
} from './contract.js';
import { COPILOT_FAILURES, CopilotRequests } from './copilot-requests.js';

/**
 * The copilot's activities (spec 07c), hosted by the review worker. Every public method is an
 * activity named after it; each is safe to retry. An unreachable declarations service or
 * ai-gateway propagates, so Temporal retries with backoff.
 */
@Injectable()
export class CopilotActivities {
  constructor(private readonly requests: CopilotRequests) {}

  /** `requestCopilot(caseId)`: asks the gateway for the case's summary and explanations. */
  requestCopilot(request: CopilotActivityRequest): Promise<void> {
    return this.requests.request({ ...request, actingSubject: SYSTEM_SUBJECT });
  }

  /** Pulls the latest request's jobs and records those that have ended. */
  settleCopilot({ tenant, caseId }: { tenant: string; caseId: string }): Promise<void> {
    return this.requests.settle(tenant, caseId);
  }

  /** Pulls an ended job's outcome from the gateway and records it on the case's copilot. */
  recordCopilotJob({ tenant, caseId, jobId }: CopilotJobFinished): Promise<void> {
    return this.requests.recordJob(tenant, caseId, jobId);
  }

  /** A page of the cases of the Commission whose copilot is `not-enabled`, after `after`. */
  notEnabledCopilots(page: {
    tenant: string;
    after: string | null;
    limit: number;
  }): Promise<NotEnabledPage> {
    return this.requests.notEnabled(page);
  }

  /**
   * The gateway (or, for a request, the declarations service: `reason`) stayed unreachable for as
   * long as the workflow tried: the copilot is `failed`, so the assignee can try again. With a
   * job, only while it is still the latest request's.
   */
  copilotUnavailable(request: {
    tenant: string;
    caseId: string;
    jobId?: string;
    reason?: CopilotUnavailableReason;
  }): Promise<void> {
    return this.requests.fail(
      request.tenant,
      request.caseId,
      request.reason ?? COPILOT_FAILURES.unavailable,
      { jobId: request.jobId },
    );
  }
}
