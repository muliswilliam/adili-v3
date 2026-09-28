/** Synthetic task inputs and model outputs for tests. No real person appears here. */

const ITEM_ID = '0199a8f0-1111-7000-8000-000000000001';
export const FLAG_ID = '0199a8f0-2222-7000-8000-000000000002';

const flag = {
  id: FLAG_ID,
  ruleId: 'value-change-25',
  severity: 'medium',
  title: 'Value change above 25%',
  indicator: 'value change 41%',
  evidence: { previous: 4_200_000, current: 5_922_000, percent: 41 },
  itemRefs: [{ sectionKey: 'land', personKey: 'declarant', itemId: ITEM_ID, fieldPath: null }],
};

export const summarizeInput = {
  kind: 'summarize-declaration',
  document: {
    declarant: { personKey: 'declarant', name: 'Test Declarant' },
    sections: { land: [{ id: ITEM_ID, description: 'Plot in Machakos', value: 5_922_000 }] },
  },
  previousDocument: {
    declarant: { personKey: 'declarant', name: 'Test Declarant' },
    sections: { land: [{ id: ITEM_ID, description: 'Plot in Machakos', value: 4_200_000 }] },
  },
  changes: [
    {
      kind: 'value-changed',
      personKey: 'declarant',
      sectionKey: 'land',
      itemId: ITEM_ID,
      percent: 41,
    },
  ],
  flags: [flag],
  registryStatuses: [{ system: 'ardhisasa', status: 'matched' }],
  language: 'en',
};

export const summarizeOutput = {
  overview: 'A biennial declaration by the declarant covering one parcel of land.',
  changesSincePrevious: [
    {
      text: 'The declared value of the plot in Machakos rose by 41%.',
      refs: [{ sectionKey: 'land', personKey: 'declarant', itemId: ITEM_ID, fieldPath: null }],
    },
  ],
  sections: [
    {
      sectionKey: 'land',
      text: 'One plot in Machakos valued at 5,922,000.',
      refs: [{ sectionKey: 'land', personKey: 'declarant', itemId: ITEM_ID, fieldPath: null }],
    },
  ],
  worthAttention: [{ text: 'Check the basis of the revaluation.', flagIds: [FLAG_ID] }],
};

export const explainInput = {
  kind: 'explain-flags',
  flags: [flag],
  itemContext: [
    {
      ref: { sectionKey: 'land', personKey: 'declarant', itemId: ITEM_ID, fieldPath: null },
      context: { type: 'land', description: 'Plot in Machakos', value: 5_922_000 },
    },
  ],
  language: 'sw',
};

export const usage = {
  inputTokens: 1200,
  outputTokens: 300,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export function taskRequest(input: object, overrides: object = {}) {
  return {
    tenant: 'demo',
    dataClass: 'synthetic',
    subjectRef: 'review-case:0199a8f0-3333-7000-8000-000000000003',
    input,
    ...overrides,
  };
}
