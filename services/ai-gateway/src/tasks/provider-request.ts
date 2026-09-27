import { canonical } from '../hashing.js';
import type { StructuredRequest } from '../providers/port.js';
import type { TaskDefinition } from './task.js';

export interface RequestRoute {
  model: string;
  maxOutputTokens: number;
}

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
  route: RequestRoute,
): StructuredRequest {
  return {
    model: route.model,
    system: task.prompt(promptVersion),
    messages: [
      {
        role: 'user',
        content: `Task input (JSON):\n<input>\n${JSON.stringify(canonical(input))}\n</input>`,
      },
    ],
    maxOutputTokens: route.maxOutputTokens,
    schema: task.outputJsonSchema,
  };
}
