import type { GenerateRequest, StructuredRequest } from '../providers/port.js';
import { buildProviderRequest, type CallParams } from '../tasks/provider-request.js';
import type { TaskDefinition } from '../tasks/task.js';
import { type Minimised, minimise } from './minimisation.js';

export interface PreparedPrompt {
  /** What the provider receives: minimised, wrapped as untrusted, deterministic. */
  request: StructuredRequest;
  /** Puts the identifiers back into the provider's output. Held for the job only. */
  restore: Minimised<unknown>['restore'];
  counts: Minimised<unknown>['counts'];
}

/**
 * The provider request a job makes for `input`: identifiers minimised, then the prompt built
 * with the input as untrusted data. Replay fixtures and evals key on this request, so anything
 * that must match what a job sends goes through here.
 */
export function preparePrompt(
  task: TaskDefinition,
  promptVersion: number,
  input: unknown,
  model: string,
  params: CallParams = {},
): PreparedPrompt {
  const minimised = minimise(input);
  return {
    request: buildProviderRequest(task, promptVersion, minimised.input, model, params),
    restore: minimised.restore,
    counts: minimised.counts,
  };
}

/**
 * The request a streamed task sends (ADR-0019): the job's request without the output schema, since
 * the model writes tagged text that the gateway reads and checks against the schema itself.
 */
export function streamedRequest(request: StructuredRequest): GenerateRequest {
  const sent: GenerateRequest & Partial<Pick<StructuredRequest, 'schema'>> = { ...request };
  delete sent.schema;
  return sent;
}
