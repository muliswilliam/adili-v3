import type { Client } from '@temporalio/client';

/**
 * Every payload in a workflow's Temporal history (inputs, activity inputs and results, signals,
 * the result), decoded as text: what a check for personal data in the history searches.
 */
export async function historyPayloads(client: Client, workflowId: string): Promise<string> {
  const history = await client.workflow.getHandle(workflowId).fetchHistory();
  const decoder = new TextDecoder();
  const texts: string[] = [];
  const visit = (value: unknown): void => {
    if (value instanceof Uint8Array) {
      texts.push(decoder.decode(value));
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value !== null && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  visit(history);
  return texts.join('\n');
}
