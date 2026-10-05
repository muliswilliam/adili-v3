import type { components } from './ai-gateway-api.gen.js';

type Schemas = components['schemas'];

/** ai-gateway.yaml `NarrateComplianceReportInput`: the NCR's figures and candidates, no person. */
export type NarrateComplianceReportInput = Schemas['NarrateComplianceReportInput'];

/** The tasks the reporting service runs (ai-gateway.yaml `TaskName`). */
export type ReportingTask = 'narrate-compliance-report';

/** ai-gateway.yaml `DataClass`: how sensitive the input is; the gateway's gate decides who may see it. */
export type DataClass = Schemas['DataClass'];

/** ai-gateway.yaml `JobStatus` and `JobReason`. */
export type AiJobStatus = Schemas['JobStatus'];
export type AiJobReason = Schemas['JobReason'];

export const AI_JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'blocked',
] as const satisfies readonly AiJobStatus[];

/** Every `JobReason`, as the client validates the gateway's answers. */
export const AI_JOB_REASONS = [
  'policy',
  'budget',
  'validation',
  'refused',
  'provider',
  'provider-unavailable',
  'timeout',
  'cancelled',
] as const satisfies readonly AiJobReason[];

/**
 * The longest a task call waits for its job to end (spec 09b): the analyst waits on a narrative
 * draft this long, and a job not done by then is polled. Within the gateway's 30 s maximum.
 */
export const MAX_TASK_WAIT_SECONDS = 20;

export interface RunTaskOptions {
  /** Up to `MAX_TASK_WAIT_SECONDS`; default 0, the job as created. */
  waitSeconds?: number;
}

/**
 * A task call (ai-gateway.yaml `TaskRequest`), narrowed to the inputs the reporting service
 * sends. `tenant` is whom the service acts for (`eacc`), sent as `X-Acting-Tenant` (ADR-013 §8.8).
 */
export interface TaskRequest {
  tenant: string;
  dataClass: DataClass;
  /** `national-report:<id>`: the events of the job carry it back. */
  subjectRef: string;
  /** The task's prompt version; part of what the idempotency key names. */
  promptVersion: number;
  input: NarrateComplianceReportInput;
}

/**
 * A job as the gateway gives it (ai-gateway.yaml `Job`), reduced to what the reporting service
 * reads. `output` is the validated task output, present only once the job succeeded.
 */
export interface AiJob {
  id: string;
  task: string;
  subjectRef: string;
  status: AiJobStatus;
  reason: AiJobReason | null;
  promptVersion: number;
  output: Record<string, unknown> | null;
  finishedAt: string | null;
}

/** Whether a job has ended: its output, or why there is none, is final. */
export function isFinished(job: Pick<AiJob, 'status'>): boolean {
  return job.status === 'succeeded' || job.status === 'failed' || job.status === 'blocked';
}

/**
 * The ai-gateway is unreachable, rate-limited the call or answered outside its contract: no job
 * was recorded as requested. Requests answer 503.
 */
export class AiGatewayUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AiGatewayUnavailable';
  }
}

/**
 * What the reporting service asks of the ai-gateway's internal API (spec 09b, ADR-007): the only
 * component that reaches an AI provider. A Nest token: the service uses `HttpAiGatewayClient`,
 * tests a fake.
 */
export abstract class AiGatewayClient {
  /**
   * `runTask`: the job as created (queued), or as it is when the request was already answered (a
   * replay of the key, or a cached result); with `waitSeconds`, as it is once it ended or the wait
   * ran out. Idempotent by `idempotencyKey`. Throws `AiGatewayUnavailable` when the gateway cannot
   * take it and `InternalApiRejected` when it refuses the request.
   */
  abstract runTask(
    task: ReportingTask,
    request: TaskRequest,
    idempotencyKey: string,
    options?: RunTaskOptions,
  ): Promise<AiJob>;

  /**
   * `getJob`: the job with its output once succeeded; null when the gateway has no such job of
   * the tenant's. Throws `AiGatewayUnavailable` when the gateway cannot answer.
   */
  abstract getJob(tenant: string, jobId: string): Promise<AiJob | null>;
}
