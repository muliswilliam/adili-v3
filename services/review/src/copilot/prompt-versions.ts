import type { ReviewTask } from '../ai-gateway/ai-gateway-client.js';

/**
 * The prompt version of each task the review service asks for (ai-gateway `prompts/<task>/v<n>`).
 * Pinned here, not left to the gateway's current one, so a request's idempotency key names what
 * it asks for: a new prompt version is a new request, with new jobs, once this moves on.
 */
export const COPILOT_PROMPT_VERSIONS: Readonly<Record<ReviewTask, number>> = {
  'summarize-declaration': 1,
  'explain-flags': 1,
  'draft-clarification': 2,
};
