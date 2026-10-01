import { Injectable } from '@nestjs/common';
import {
  type Attributes,
  type Counter,
  type Histogram,
  metrics,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

import type { Job } from '../db/schema.js';
import { ProviderError, type StructuredResult, totalInputTokens } from '../providers/port.js';

/**
 * OpenTelemetry for provider calls and jobs, following the GenAI semantic conventions: a client
 * span per call with `gen_ai.*` attributes, the `gen_ai.client.*` metrics, and job outcome, cost
 * and token counters per tenant and task. Names, ids, counts and decisions only: never a prompt,
 * an input or an output.
 */

const SCOPE = 'ai-gateway';
const OPERATION = 'chat';

export const GEN_AI = {
  operationName: 'gen_ai.operation.name',
  /** Superseded by `gen_ai.provider.name`; both are set while backends move over. */
  system: 'gen_ai.system',
  providerName: 'gen_ai.provider.name',
  requestModel: 'gen_ai.request.model',
  requestMaxTokens: 'gen_ai.request.max_tokens',
  responseModel: 'gen_ai.response.model',
  responseFinishReasons: 'gen_ai.response.finish_reasons',
  usageInputTokens: 'gen_ai.usage.input_tokens',
  usageOutputTokens: 'gen_ai.usage.output_tokens',
  usageCacheReadTokens: 'gen_ai.usage.cache_read.input_tokens',
  usageCacheCreationTokens: 'gen_ai.usage.cache_creation.input_tokens',
  tokenType: 'gen_ai.token.type',
  errorType: 'error.type',
} as const;

/** Gateway attributes next to the GenAI ones. */
export const AI_ATTRIBUTES = {
  jobId: 'adili.ai.job_id',
  task: 'adili.ai.task',
  promptVersion: 'adili.ai.prompt_version',
  tenant: 'adili.tenant',
  outcome: 'adili.ai.outcome',
  reason: 'adili.ai.reason',
} as const;

export interface CallContext {
  jobId: string;
  tenant: string;
  task: string;
  promptVersion: number;
  provider: string;
  model: string;
  maxOutputTokens: number;
}

const FINISH_REASONS: Record<StructuredResult['status'], string> = {
  completed: 'stop',
  truncated: 'length',
  refused: 'refusal',
};

@Injectable()
export class GenAiTelemetry {
  private readonly tokenUsage: Histogram;
  private readonly duration: Histogram;
  private readonly jobs: Counter;
  private readonly cost: Counter;
  private readonly tokens: Counter;

  constructor() {
    const meter = metrics.getMeter(SCOPE);
    this.tokenUsage = meter.createHistogram('gen_ai.client.token.usage', {
      description: 'Tokens used per provider call',
      unit: '{token}',
      advice: {
        explicitBucketBoundaries: [
          1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304,
        ],
      },
    });
    this.duration = meter.createHistogram('gen_ai.client.operation.duration', {
      description: 'Duration of provider calls',
      unit: 's',
      advice: {
        explicitBucketBoundaries: [
          0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48, 40.96, 81.92,
        ],
      },
    });
    this.jobs = meter.createCounter('adili.ai.jobs', {
      description: 'Finished jobs by tenant, task, outcome and reason (blocked and failed counts)',
      unit: '{job}',
    });
    this.cost = meter.createCounter('adili.ai.cost', {
      description: 'Estimated provider cost of finished jobs, at list price',
      unit: 'u[USD]',
    });
    this.tokens = meter.createCounter('adili.ai.tokens', {
      description: 'Tokens used by finished jobs, by tenant and task',
      unit: '{token}',
    });
  }

  /** Runs one provider call inside a GenAI client span, recording its usage and duration. */
  async call(
    context: CallContext,
    run: () => Promise<StructuredResult>,
  ): Promise<StructuredResult> {
    const base: Attributes = {
      [GEN_AI.operationName]: OPERATION,
      [GEN_AI.system]: context.provider,
      [GEN_AI.providerName]: context.provider,
      [GEN_AI.requestModel]: context.model,
    };
    return trace.getTracer(SCOPE).startActiveSpan(
      `${OPERATION} ${context.model}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          ...base,
          [GEN_AI.requestMaxTokens]: context.maxOutputTokens,
          [AI_ATTRIBUTES.jobId]: context.jobId,
          [AI_ATTRIBUTES.tenant]: context.tenant,
          [AI_ATTRIBUTES.task]: context.task,
          [AI_ATTRIBUTES.promptVersion]: context.promptVersion,
        },
      },
      async (span) => {
        const startedAt = performance.now();
        try {
          const result = await run();
          const usage = result.usage;
          span.setAttributes({
            [GEN_AI.responseModel]: result.model,
            [GEN_AI.responseFinishReasons]: [FINISH_REASONS[result.status]],
            [GEN_AI.usageInputTokens]: totalInputTokens(usage),
            [GEN_AI.usageOutputTokens]: usage.outputTokens,
            [GEN_AI.usageCacheReadTokens]: usage.cacheReadTokens,
            [GEN_AI.usageCacheCreationTokens]: usage.cacheWriteTokens,
          });
          const withResponse = { ...base, [GEN_AI.responseModel]: result.model };
          this.tokenUsage.record(totalInputTokens(usage), {
            ...withResponse,
            [GEN_AI.tokenType]: 'input',
          });
          this.tokenUsage.record(usage.outputTokens, {
            ...withResponse,
            [GEN_AI.tokenType]: 'output',
          });
          this.duration.record((performance.now() - startedAt) / 1000, withResponse);
          return result;
        } catch (error) {
          const errorType = error instanceof ProviderError ? error.kind : '_OTHER';
          // The kind only: provider messages are kept off spans like everything else.
          span.setAttribute(GEN_AI.errorType, errorType);
          span.setStatus({ code: SpanStatusCode.ERROR, message: errorType });
          this.duration.record((performance.now() - startedAt) / 1000, {
            ...base,
            [GEN_AI.errorType]: errorType,
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  /** Counts a job that has just ended, with its tokens and cost. */
  jobFinished(job: Job): void {
    const attributes: Attributes = {
      [AI_ATTRIBUTES.tenant]: job.tenant,
      [AI_ATTRIBUTES.task]: job.task,
      [AI_ATTRIBUTES.outcome]: job.status,
      ...(job.reason && { [AI_ATTRIBUTES.reason]: job.reason }),
    };
    this.jobs.add(1, attributes);
    const usage = {
      [AI_ATTRIBUTES.tenant]: job.tenant,
      [AI_ATTRIBUTES.task]: job.task,
      [GEN_AI.requestModel]: job.model,
    };
    if (job.costMicros > 0) this.cost.add(job.costMicros, usage);
    if (job.tokensIn > 0) this.tokens.add(job.tokensIn, { ...usage, [GEN_AI.tokenType]: 'input' });
    if (job.tokensOut > 0) {
      this.tokens.add(job.tokensOut, { ...usage, [GEN_AI.tokenType]: 'output' });
    }
  }
}
