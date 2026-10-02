/** Synthetic task inputs and model outputs for tests. No real person appears here. */

import type { NarrateInput, NarrateOutput } from '../../src/tasks/narrate-compliance-report.js';

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

/** The header naming the tenant a service acts for (ADR-013 §8.8). */
export function actingFor(tenant = 'demo'): { 'x-acting-tenant': string } {
  return { 'x-acting-tenant': tenant };
}

/**
 * A task call written with its tenant (as `taskRequest` gives it), split into the request body
 * and the `X-Acting-Tenant` header that carries the tenant.
 */
export function taskCall({ tenant = 'demo', ...body }: { tenant?: string } & object): {
  headers: { 'x-acting-tenant': string };
  body: object;
} {
  return { headers: actingFor(tenant), body };
}

/** Synthetic aggregates for FY2026 with one prior year. */
export const narrateInput: NarrateInput = {
  kind: 'narrate-compliance-report',
  fy: 2026,
  totals: { expected: 12_480, filed: 11_204, late: 960 },
  rates: { filingRate: 0.8977, lateRate: 0.0769 },
  commissionTable: [
    {
      code: 'tsc',
      commissionName: 'Teachers Service Commission',
      figures: { expected: 8_200, nonFilerRate: 0.164 },
    },
    {
      code: 'psc',
      commissionName: 'Public Service Commission',
      figures: { expected: 4_280, nonFilerRate: 0.051 },
    },
  ],
  priorYears: [
    {
      fy: 2025,
      totals: { expected: 12_010, filed: 11_350 },
      rates: { filingRate: 0.945 },
      commissionTable: [
        {
          code: 'tsc',
          commissionName: 'Teachers Service Commission',
          figures: { expected: 7_900, nonFilerRate: 0.082 },
        },
      ],
    },
  ],
  candidates: [
    {
      id: 'rate-change:tsc:nonFilerRate',
      kind: 'rate-change',
      subject: 'tsc',
      values: { from: 0.082, to: 0.164, change: 1 },
      aggregateKeys: ['fy2025.commission.tsc.nonFilerRate', 'commission.tsc.nonFilerRate'],
    },
  ],
  section: 'all',
  language: 'en',
};

export const narrateOutput: NarrateOutput = {
  paragraphs: [
    {
      section: 'overview',
      text: 'In FY2025/26, 11,204 of 12,480 expected declarations were filed, a filing rate of 89.8%, down from 94.5% in 2025.',
      aggregateRefs: [
        'national.filed',
        'national.expected',
        'national.filingRate',
        'fy2025.national.filingRate',
      ],
      candidateIds: [],
    },
    {
      section: 'findings',
      text: "The Teachers Service Commission's non-filer rate doubled, from 8.2% to 16.4%.",
      aggregateRefs: ['commission.tsc.nonFilerRate', 'fy2025.commission.tsc.nonFilerRate'],
      candidateIds: ['rate-change:tsc:nonFilerRate'],
    },
    {
      section: 'recommendations',
      text: 'EACC should ask the Teachers Service Commission to account for its non-filers.',
      aggregateRefs: ['commission.tsc.nonFilerRate'],
      candidateIds: ['rate-change:tsc:nonFilerRate'],
    },
  ],
};
