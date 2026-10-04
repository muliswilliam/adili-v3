import type { NewEvent } from '@adili/events';

/**
 * Events of Ask Adili (spec 11). Identifiers and flags only: never a question or an answer, or
 * the reporting officer's contact. The `tenant` extension is the conversation's Commission; the
 * subject is the conversation.
 */

export const ASSISTANT_MESSAGE_ANSWERED = 'assistant.message.answered.v1';

export interface AssistantMessageAnsweredData extends Record<string, unknown> {
  conversationId: string;
  /** The answer's message id. */
  messageId: string;
  tenant: string;
  /** The section the declarant asked from; null outside a draft. */
  sectionKey: string | null;
  /** The corpus did not support an answer (unanswered-question counts, spec 11 S8). */
  declined: boolean;
  /** The ai-gateway job; null when nothing was retrieved and no job was run. */
  jobId: string | null;
}

export function assistantMessageAnswered(
  data: AssistantMessageAnsweredData,
): NewEvent<AssistantMessageAnsweredData> {
  return {
    type: ASSISTANT_MESSAGE_ANSWERED,
    subject: data.conversationId,
    tenant: data.tenant,
    data,
  };
}
