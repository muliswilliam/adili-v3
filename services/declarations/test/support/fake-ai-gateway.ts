import { randomUUID } from 'node:crypto';

import {
  AiGatewayClient,
  AiGatewayUnavailable,
  type ExtractDocumentOutput,
  type ExtractionJob,
  type ExtractionRequest,
} from '../../src/ai-gateway/ai-gateway-client.js';

/** A job as the fake gateway holds it: the request that made it, and where it stands. */
export interface FakeJob extends ExtractionJob {
  tenant: string;
  subjectRef: string;
  request: ExtractionRequest;
}

/** What a reading of a logbook gives, unless a test says otherwise. */
export function logbookReading(
  overrides: Partial<ExtractDocumentOutput> = {},
): ExtractDocumentOutput {
  return {
    label: {
      aiAssisted: true,
      task: 'extract-document',
      promptVersion: 1,
      provider: 'replay',
      model: 'claude-opus-5-5',
      generatedAt: '2026-10-03T08:00:00.000Z',
      disclaimer: 'AI-assisted. Read from your document: check every field before you use it.',
    },
    detectedKind: 'logbook',
    fields: [
      { name: 'details.registration', value: 'KCB 782M', confidence: 0.97, page: 1 },
      { name: 'details.makeModel', value: 'Toyota Premio', confidence: 0.82, page: 1 },
      { name: 'value.kesCents', value: 95_000_000, confidence: 0.41, page: null },
    ],
    warnings: ['Page 2 could not be read.'],
    ...overrides,
  };
}

/**
 * The ai-gateway's task and job API for tests. A request makes a `queued` job, unless the
 * Commission is `blocked` (its policy keeps highly-confidential data from providers: the job is
 * `blocked`, `policy`), or an equal request (same tenant, subject and input, the link aside) has
 * a live or succeeded job, which is returned instead (the gateway's cache). `finish` ends a job as
 * the gateway's queue would; the test then delivers its event. `unavailable` fails every call.
 */
export class FakeAiGateway extends AiGatewayClient {
  readonly requests: { request: ExtractionRequest; idempotencyKey: string }[] = [];
  readonly jobs = new Map<string, FakeJob>();
  readonly blocked = new Set<string>();
  unavailable = false;
  /** Fails the job read only (`getJob`), as a gateway gone after taking the request would. */
  getJobUnavailable = false;

  reset(): void {
    this.requests.length = 0;
    this.jobs.clear();
    this.blocked.clear();
    this.unavailable = false;
    this.getJobUnavailable = false;
  }

  extractDocument(request: ExtractionRequest, idempotencyKey: string): Promise<ExtractionJob> {
    if (this.unavailable) return Promise.reject(new AiGatewayUnavailable('No answer'));
    this.requests.push({ request, idempotencyKey });
    const cached = [...this.jobs.values()].find(
      (job) =>
        job.status !== 'failed' &&
        job.status !== 'blocked' &&
        job.tenant === request.tenant &&
        identity(job.request) === identity(request),
    );
    if (cached) return Promise.resolve(view(cached));
    const blocked = this.blocked.has(request.tenant);
    const job: FakeJob = {
      id: randomUUID(),
      tenant: request.tenant,
      subjectRef: request.subjectRef,
      request,
      status: blocked ? 'blocked' : 'queued',
      reason: blocked ? 'policy' : null,
      output: null,
    };
    this.jobs.set(job.id, job);
    return Promise.resolve(view(job));
  }

  getJob(tenant: string, jobId: string): Promise<ExtractionJob | null> {
    if (this.unavailable || this.getJobUnavailable) {
      return Promise.reject(new AiGatewayUnavailable('No answer'));
    }
    const job = this.jobs.get(jobId);
    return Promise.resolve(job?.tenant === tenant ? view(job) : null);
  }

  /** The one job the gateway has; fails when there is not exactly one. */
  onlyJob(): FakeJob {
    const [job, ...others] = this.jobs.values();
    if (!job || others.length > 0) throw new Error(`${String(this.jobs.size)} jobs, not one`);
    return job;
  }

  /** Ends the job: succeeded with `output` (null: since purged), or failed with `reason`. */
  finish(
    jobId: string,
    outcome:
      { output: ExtractDocumentOutput | null } | { reason: NonNullable<ExtractionJob['reason']> },
  ): FakeJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`No job ${jobId}`);
    if ('output' in outcome) {
      Object.assign(job, { status: 'succeeded', reason: null, output: outcome.output });
    } else {
      Object.assign(job, { status: 'failed', reason: outcome.reason, output: null });
    }
    return job;
  }
}

function view({ id, status, reason, output }: FakeJob): ExtractionJob {
  return { id, status, reason, output };
}

/** What the gateway's cache keys a request on: everything but the short-lived link. */
function identity({ tenant, subjectRef, input }: ExtractionRequest): string {
  const { contentType, sha256 } = input.attachment;
  return JSON.stringify({
    tenant,
    subjectRef,
    input: { ...input, attachment: { contentType, sha256 } },
  });
}
