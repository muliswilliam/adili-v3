import type { ReadDocument } from '../documents/read-document.js';
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
 * The provider request a job makes for `input`: the input as the model sees it (with the
 * `document`'s text layer, for a task that reads one), identifiers minimised, then the prompt
 * built with the input as untrusted data and the document's other pages attached. Replay fixtures
 * and evals key on this request, so anything that must match what a job sends goes through here.
 */
export function preparePrompt(
  task: TaskDefinition,
  promptVersion: number,
  input: unknown,
  model: string,
  params: CallParams = {},
  document?: ReadDocument,
): PreparedPrompt {
  if (task.document && !document) {
    throw new Error(`Task ${task.name} reads a document, and none was given`);
  }
  const sent = task.modelInput ? task.modelInput(input as never, document) : input;
  const minimised = minimise(sent);
  return {
    request: buildProviderRequest(
      task,
      promptVersion,
      minimised.input,
      model,
      params,
      input,
      document?.visual ?? null,
    ),
    restore: minimised.restore,
    counts: minimised.counts,
  };
}

/**
 * The request a streamed task sends (ADR-019): the job's request without the output schema, since
 * the model writes tagged text that the gateway reads and checks against the schema itself.
 */
export function streamedRequest(request: StructuredRequest): GenerateRequest {
  const sent: GenerateRequest & Partial<Pick<StructuredRequest, 'schema'>> = { ...request };
  delete sent.schema;
  return sent;
}
