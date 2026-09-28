import { canonicalJson } from '@adili/api-kit';

import type { StructuredRequest } from '../providers/port.js';
import type { TaskDefinition } from './task.js';

/**
 * The neutral provider request for one job: the version's prompt as the (cached) system
 * prompt, the task input as the user message, and the output schema for structured output.
 * Deterministic (the input is serialised canonically), so equal jobs make equal requests and
 * replay fixtures match.
 */
export function buildProviderRequest(
  task: TaskDefinition,
  promptVersion: number,
  input: unknown,
  /** Decided by the routing table. */
  model: string,
): StructuredRequest {
  return {
    model,
    system: task.prompt(promptVersion),
    messages: [
      {
        role: 'user',
        content: `Task input (JSON):\n<input>\n${canonicalJson(input)}\n</input>`,
      },
    ],
    maxOutputTokens: task.maxOutputTokens,
    schema: task.outputJsonSchema,
  };
}
