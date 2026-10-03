import { plural } from '@adili/ui';

/**
 * Copy of Draft with AI in the clarification composer (spec 07c FE-3), as the frontend comment
 * on #272 and the 07a-review prototype word it. English with empty Swahili slots, as elsewhere
 * in the console; the draft's language is a task input, not this copy's.
 */
export const en = {
  legend: 'Draft with AI',
  draftFrom: 'Draft from',
  addFirst: 'Add a flag or item',
  addMore: 'Add more',
  addLabel: 'Add a flag or item to draft from',
  flagsGroup: 'Flags',
  itemsGroup: 'Items',
  itemOption: (description: string, person: string) => `${description} (${person})`,
  remove: (name: string) => `Remove ${name}`,
  draftsIn: (language: string) => `Drafts in ${language}, the letter's language.`,
  draft: 'Draft with AI',
  drafting: 'Drafting…',
  draftingStatus: 'Drafting',
  stillDrafting: 'Still drafting. Checking again…',
  pickFirst: 'Add at least one flag or item first.',
  notEnabled: 'AI assistance is not enabled for this Commission.',
  notEnabledShort: 'Not enabled for this Commission',
  inserted: (items: number) =>
    `${plural(items, 'draft item')} added. Check each one before issuing.`,
  failed: (reason: string) => `Draft not available (${reason}). You can write the items manually.`,
  reasons: {
    'provider-unavailable': 'AI service unavailable',
    provider: 'AI service error',
    timeout: 'timed out',
    refused: 'declined by the AI model',
    validation: 'output failed its checks',
    'output-purged': 'the output expired before it was saved',
    budget: 'monthly AI budget used up',
    policy: 'not allowed for this Commission',
    rejected: 'the AI service refused the request',
    missing: 'the draft has expired',
    'ai-gateway-unavailable': 'AI service unavailable',
    'selection-not-on-case': 'a flag or item is no longer on the case',
  } as Record<string, string>,
  unknownReason: 'unknown error',
  notAssignee: 'Only the reviewer holding the case can draft with AI.',
  sessionEnded: 'Your session has ended. Sign in again.',
};

export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
