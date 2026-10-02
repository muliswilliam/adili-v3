import { describe, expect, it } from 'vitest';

import type { GateRule, GateRuleInput, TenantUsage } from '../../server/ai-gateway/types';
import { type AiTenantRow, gateOf } from '../../server/ai-policy.server';
import {
  accessOf,
  accessText,
  belowUsage,
  budgetErrors,
  budgetResetsOn,
  changedByText,
  confirmText,
  filterCounts,
  filterRows,
  formatCost,
  gateChanges,
  gateDraft,
  gateHistory,
  longMonth,
  pageOf,
  parseWholeNumber,
  routeDraft,
  routeErrors,
  routeInput,
  routeParams,
  searchRows,
  shortMonth,
} from './model';

function rule(overrides: Partial<GateRule> = {}): GateRule {
  return {
    dataClass: 'synthetic',
    providerClass: 'external',
    allowed: true,
    approvalRef: 'EACC/AI/2026/014',
    changedBy: '7d1c2a4e-0000-4000-8000-00000000a001',
    changedByName: 'Amina Wanjiru',
    changedAt: '2026-09-01T08:40:00Z',
    ...overrides,
  };
}

/** Every cell blocked by default, so each test's rules alone decide what is allowed. */
const BLOCKED: GateRuleInput[] = (
  ['synthetic', 'restricted', 'highly-confidential'] as const
).flatMap((dataClass) =>
  (['external', 'self-hosted'] as const).map((providerClass) => ({
    dataClass,
    providerClass,
    allowed: false,
  })),
);

/** The gateway's default: self-hosted sees everything, external nothing. */
const DEFAULTS: GateRuleInput[] = BLOCKED.map((cell) => ({
  ...cell,
  allowed: cell.providerClass === 'self-hosted',
}));

const gate = (rules: GateRule[], defaults = BLOCKED) => gateOf(defaults, rules);
const routedTo = (
  rules: GateRule[],
  routed: AiTenantRow['routed'] = ['external', 'self-hosted'],
) => ({
  gate: gate(rules),
  routed,
});

function usage(tokensUsed: number, monthlyTokens = 1_000_000): TenantUsage {
  return {
    tenant: 'x',
    month: '2026-09',
    monthlyTokens,
    perMinute: 60,
    tokensUsed,
    costMicros: 0,
    jobs: 0,
    blocked: 0,
    failed: 0,
  };
}

function row(slug: string, name: string, rules: GateRule[], used: number | null = 0): AiTenantRow {
  return {
    slug,
    name,
    gate: gate(rules),
    routed: ['external'],
    usage: used === null ? null : usage(used),
  };
}

describe('accessText', () => {
  it('reads "External provider, synthetic data only" for the demo set-up', () => {
    expect(accessText(accessOf(routedTo([rule()])))).toBe('External provider, synthetic data only');
  });

  it('lists every data class per provider class', () => {
    const rules = [
      rule(),
      rule({ dataClass: 'restricted' }),
      rule({ dataClass: 'highly-confidential', providerClass: 'self-hosted' }),
    ];
    expect(accessText(accessOf(routedTo(rules)))).toBe(
      'External provider, synthetic and restricted data; self-hosted provider, highly confidential data',
    );
  });

  it('is null when nothing is allowed, blocked rules included', () => {
    expect(accessText(accessOf(routedTo([rule({ allowed: false })])))).toBeNull();
  });

  it('leaves out provider classes nothing is routed to, and applies the default gate', () => {
    const defaults = { gate: gate([], DEFAULTS), routed: ['external' as const] };
    expect(accessOf(defaults)).toEqual([]);
    expect(accessText(accessOf({ ...defaults, routed: ['self-hosted'] }))).toBe(
      'Self-hosted provider, synthetic, restricted and highly confidential data',
    );
    expect(accessOf({ ...defaults, routed: [] })).toEqual([]);
    expect(accessText(accessOf({ gate: gate([rule()], DEFAULTS), routed: ['external'] }))).toBe(
      'External provider, synthetic data only',
    );
  });
});

describe('filters', () => {
  const rows = [
    row('demo', 'Demo Commission', [rule()], 200_000),
    row('jsc', 'Judicial Service Commission', [rule()], 860_000),
    row('tsc', 'Teachers Service Commission', []),
    row('psc', 'Public Service Commission', [rule()], null),
  ];

  it('counts each chip over the searched rows', () => {
    expect(filterCounts(rows)).toEqual({ all: 4, enabled: 3, 'not-enabled': 1, budget: 1 });
    expect(filterCounts(searchRows(rows, 'service'))).toEqual({
      all: 3,
      enabled: 2,
      'not-enabled': 1,
      budget: 1,
    });
  });

  it('matches the name or the slug', () => {
    expect(searchRows(rows, 'TSC').map((each) => each.slug)).toEqual(['tsc']);
    expect(searchRows(rows, 'judicial').map((each) => each.slug)).toEqual(['jsc']);
    expect(searchRows(rows, '  ')).toHaveLength(4);
  });

  it('puts enabled Commissions at 80% or more of their budget under "Budget 80%+"', () => {
    expect(filterRows(rows, 'budget').map((each) => each.slug)).toEqual(['jsc']);
  });

  it('pages by 20 and keeps the page in range', () => {
    const many = Array.from({ length: 45 }, (_, index) => row(`c${String(index)}`, 'C', []));
    expect(pageOf(many, 3)).toMatchObject({ page: 3, pages: 3, from: 41, to: 45 });
    expect(pageOf(many, 9)).toMatchObject({ page: 3 });
    expect(pageOf([], undefined)).toMatchObject({ page: 1, pages: 1, rows: [] });
  });
});

describe('the edit dialog', () => {
  it('lists the cells the draft changes, in table order', () => {
    const cells = gate([rule()]);
    const draft = gateDraft(cells);
    expect(gateChanges(cells, draft)).toEqual([]);
    draft['synthetic|external'] = false;
    draft['highly-confidential|self-hosted'] = true;
    expect(gateChanges(cells, draft)).toEqual([
      { dataClass: 'synthetic', providerClass: 'external', allowed: false },
      { dataClass: 'highly-confidential', providerClass: 'self-hosted', allowed: true },
    ]);
  });

  it('words each change for the confirm step', () => {
    expect(
      confirmText(
        { dataClass: 'synthetic', providerClass: 'external', allowed: true },
        'Teachers Service Commission',
      ),
    ).toBe('External providers may process synthetic data for Teachers Service Commission.');
    expect(
      confirmText(
        { dataClass: 'synthetic', providerClass: 'external', allowed: false },
        'Public Service Commission',
      ),
    ).toBe(
      'External providers will no longer process synthetic data for Public Service Commission. New AI requests are blocked; outputs already shown stay.',
    );
  });

  it('shows the latest decisions newest first', () => {
    const older = rule({ changedAt: '2026-08-01T00:00:00Z' });
    const newer = rule({ dataClass: 'restricted', changedAt: '2026-09-20T00:00:00Z' });
    expect(gateHistory(gate([older, newer]))).toEqual([newer, older]);
  });

  it('names who changed a cell, or their account id when the gateway has no name', () => {
    expect(changedByText(rule())).toBe('Amina Wanjiru');
    expect(changedByText(rule({ changedByName: null }))).toBe(
      '7d1c2a4e-0000-4000-8000-00000000a001',
    );
  });
});

describe('the budget form', () => {
  it('reads whole numbers with or without thousands separators', () => {
    expect(parseWholeNumber('1,500,000')).toBe(1_500_000);
    expect(parseWholeNumber(' 1500000 ')).toBe(1_500_000);
    expect(parseWholeNumber('0')).toBe(0);
    expect(parseWholeNumber('1.5')).toBeNull();
    expect(parseWholeNumber('-3')).toBeNull();
    expect(parseWholeNumber('')).toBeNull();
  });

  it('wants tokens of 0 or more and at least 1 request a minute', () => {
    expect(budgetErrors('1,000,000', '60')).toEqual({});
    expect(budgetErrors('', '0')).toEqual({
      monthlyTokens: 'Enter a whole number of tokens, 0 or more.',
      perMinute: 'Enter at least 1 request a minute.',
    });
  });

  it("warns when the budget is under this month's usage", () => {
    expect(belowUsage('1,500,000', usage(1_926_400))).toBe(true);
    expect(belowUsage('3,000,000', usage(1_926_400))).toBe(false);
    expect(belowUsage('abc', usage(1_926_400))).toBe(false);
  });
});

describe('formatting', () => {
  it('names the month and when a used-up budget resets', () => {
    expect(shortMonth('2026-09')).toBe('Sep 2026');
    expect(longMonth('2026-09')).toBe('September 2026');
    expect(budgetResetsOn('2026-09')).toBe('1 Oct 2026');
    expect(budgetResetsOn('2026-12')).toBe('1 Jan 2027');
  });

  it('shows the cost in dollars and cents', () => {
    expect(formatCost(24_180_000)).toBe('USD 24.18');
    expect(formatCost(0)).toBe('USD 0.00');
  });

  it('labels the parameters it knows, then the rest as given', () => {
    expect(
      routeParams({ maxOutputTokens: 3_000, effort: 'high', timeoutMs: 10_000, topP: 1 }),
    ).toEqual([
      { label: 'Max output tokens', value: '3,000' },
      { label: 'Effort', value: 'High' },
      { label: 'Timeout', value: '10 s' },
      { label: 'topP', value: '1' },
    ]);
  });
});

describe('S2 route dialog', () => {
  const route = {
    tenant: null,
    task: 'explain-flags' as const,
    provider: 'anthropic',
    providerClass: 'external' as const,
    model: 'claude-opus-5-5',
    params: { maxOutputTokens: 3_000, effort: 'low', timeoutMs: 45_500 },
  };

  it('fills the fields from the route, timeout in seconds', () => {
    expect(routeDraft(route)).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      maxOutputTokens: '3000',
      effort: 'low',
      timeoutSeconds: '46',
      approvalRef: '',
    });
    expect(routeDraft(null)).toMatchObject({ provider: '', effort: '', maxOutputTokens: '' });
  });

  it('requires provider, model and approval, and whole numbers above 0 when set', () => {
    expect(
      routeErrors({ ...routeDraft(null), maxOutputTokens: '0', timeoutSeconds: '1.5' }),
    ).toEqual({
      provider: 'Enter the provider.',
      model: 'Enter the model.',
      maxOutputTokens: 'Enter a whole number above 0, or leave it empty.',
      timeoutSeconds: 'Enter a whole number above 0, or leave it empty.',
      approvalRef: 'Enter the approval reference.',
    });
    expect(routeErrors({ ...routeDraft(route), approvalRef: 'EACC/AI/1' })).toEqual({});
  });

  it('sends only the parameters that are set', () => {
    expect(
      routeInput({ ...routeDraft(route), maxOutputTokens: '', effort: '', approvalRef: ' A/1 ' }),
    ).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      params: { timeoutMs: 46_000 },
      approvalRef: 'A/1',
    });
  });
});
