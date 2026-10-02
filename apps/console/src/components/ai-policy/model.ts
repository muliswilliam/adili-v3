import { formatDate, formatMoney, formatMonth, usagePercent } from '@adili/ui';
import { z } from 'zod';

import type {
  DataClass,
  GateRule,
  ProviderClass,
  TenantUsage,
} from '../../server/ai-gateway/types';
import type {
  AiTenantRow,
  GateCellView,
  GateChange,
  RouteRow,
} from '../../server/ai-policy.server';
import { formatNumber } from '../format';
import { messages as m } from './messages';

/**
 * What the AI policy page shows of the gateway's policy, worked out once and tested here: the
 * gate per data class, the status line, filters, the edit dialog's changes and the budget form.
 */

export const DATA_CLASSES: readonly DataClass[] = [
  'synthetic',
  'restricted',
  'highly-confidential',
];
export const PROVIDER_CLASSES: readonly ProviderClass[] = ['external', 'self-hosted'];

export function isAllowed(
  gate: readonly GateCellView[],
  dataClass: DataClass,
  providerClass: ProviderClass,
): boolean {
  return gate.some(
    (cell) => cell.dataClass === dataClass && cell.providerClass === providerClass && cell.allowed,
  );
}

/** The provider classes allowed for a data class, in the table's order. */
export function allowedProviders(
  gate: readonly GateCellView[],
  dataClass: DataClass,
): ProviderClass[] {
  return PROVIDER_CLASSES.filter((providerClass) => isAllowed(gate, dataClass, providerClass));
}

/** Provider classes with the data classes each may process, for the status text. */
export interface ProviderAccess {
  providerClass: ProviderClass;
  dataClasses: DataClass[];
}

/**
 * What the Commission's gate lets through to the provider classes its tasks are routed to: a
 * class nothing is routed to receives nothing, whatever the gate allows it.
 */
export function accessOf(row: Pick<AiTenantRow, 'gate' | 'routed'>): ProviderAccess[] {
  return PROVIDER_CLASSES.filter((each) => row.routed.includes(each)).flatMap((providerClass) => {
    const dataClasses = DATA_CLASSES.filter((dataClass) =>
      isAllowed(row.gate, dataClass, providerClass),
    );
    return dataClasses.length > 0 ? [{ providerClass, dataClasses }] : [];
  });
}

/** AI assistance is enabled when a routed provider class may process some data class. */
export function isEnabled(row: Pick<AiTenantRow, 'gate' | 'routed'>): boolean {
  return accessOf(row).length > 0;
}

/** The Commission's explicit rules, allowing or blocking. */
export function rulesOf(gate: readonly GateCellView[]): GateRule[] {
  return gate.flatMap((cell) => (cell.rule ? [cell.rule] : []));
}

/**
 * "External provider, synthetic data only"; with more, "External provider, synthetic and
 * restricted data; self-hosted provider, highly confidential data". Null when nothing is allowed.
 */
export function accessText(access: readonly ProviderAccess[]): string | null {
  if (access.length === 0) return null;
  const text = access
    .map(({ providerClass, dataClasses }) =>
      m.aiEnabledText(m.providerClass[providerClass].toLowerCase(), dataScopeText(dataClasses)),
    )
    .join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "synthetic data only" (the least a provider may get), or "synthetic and restricted data". */
export function dataScopeText(dataClasses: readonly DataClass[]): string {
  const only = dataClasses.length === 1 && dataClasses[0] === 'synthetic';
  return m.dataScope(dataClassesText(dataClasses), only);
}

/** "synthetic and restricted": the data classes in running text. */
export function dataClassesText(dataClasses: readonly DataClass[]): string {
  return joinAnd(dataClasses.map((dataClass) => m.dataClass[dataClass].toLowerCase()));
}

function joinAnd(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;
}

// --- The Commissions tab: search, filters and pages ---

export const AI_FILTERS = ['all', 'enabled', 'not-enabled', 'budget'] as const;
export type AiFilter = (typeof AI_FILTERS)[number];

/** The share of the budget from which a Commission shows under "Budget 80%+". */
const BUDGET_FILTER_PERCENT = 80;

export function usageShare(usage: TenantUsage): number {
  return usagePercent(usage.tokensUsed, usage.monthlyTokens);
}

const FILTERS: Record<AiFilter, (row: AiTenantRow) => boolean> = {
  all: () => true,
  enabled: (row) => isEnabled(row),
  'not-enabled': (row) => !isEnabled(row),
  budget: (row) =>
    isEnabled(row) && row.usage !== null && usageShare(row.usage) >= BUDGET_FILTER_PERCENT,
};

export const aiPolicySearch = z.object({
  tab: z.enum(['commissions', 'routing']).optional().catch(undefined),
  q: z.string().max(100).optional().catch(undefined),
  show: z.enum(AI_FILTERS).optional().catch(undefined),
  page: z.number().int().min(1).optional().catch(undefined),
});

export type AiPolicySearch = z.infer<typeof aiPolicySearch>;

/** Rows whose name or slug contains the search text. */
export function searchRows(rows: readonly AiTenantRow[], q: string | undefined): AiTenantRow[] {
  const text = (q ?? '').trim().toLowerCase();
  if (!text) return [...rows];
  return rows.filter((row) => row.name.toLowerCase().includes(text) || row.slug.includes(text));
}

export function filterRows(rows: readonly AiTenantRow[], filter: AiFilter): AiTenantRow[] {
  return rows.filter(FILTERS[filter]);
}

/** How many of the searched rows each filter chip would show. */
export function filterCounts(rows: readonly AiTenantRow[]): Record<AiFilter, number> {
  return {
    all: rows.length,
    enabled: filterRows(rows, 'enabled').length,
    'not-enabled': filterRows(rows, 'not-enabled').length,
    budget: filterRows(rows, 'budget').length,
  };
}

export const AI_PAGE_SIZE = 20;

export interface RowsPage {
  rows: AiTenantRow[];
  page: number;
  pages: number;
  from: number;
  to: number;
}

export function pageOf(rows: readonly AiTenantRow[], requested: number | undefined): RowsPage {
  const pages = Math.max(1, Math.ceil(rows.length / AI_PAGE_SIZE));
  const page = Math.min(Math.max(1, requested ?? 1), pages);
  const start = (page - 1) * AI_PAGE_SIZE;
  const shown = rows.slice(start, start + AI_PAGE_SIZE);
  return { rows: shown, page, pages, from: start + 1, to: start + shown.length };
}

/** The month the usage is counted in, from any row that has usage. */
export function usageMonth(rows: readonly AiTenantRow[]): string | null {
  return rows.find((row) => row.usage !== null)?.usage?.month ?? null;
}

// --- Months, money and parameters ---

const SHORT_MONTH = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });

/** `2026-09` → `Sep 2026`. */
export function shortMonth(month: string): string {
  const time = Date.parse(`${month}-15T12:00:00Z`);
  return Number.isNaN(time) ? month : `${SHORT_MONTH.format(time)} ${month.slice(0, 4)}`;
}

/** `2026-09` → `September 2026`. */
export function longMonth(month: string): string {
  const time = Date.parse(`${month}-15T12:00:00Z`);
  return Number.isNaN(time) ? month : formatMonth(new Date(time).toISOString());
}

/** `2026-09` → `1 Oct 2026`: when a used-up budget starts again. */
export function budgetResetsOn(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return month;
  const next = new Date(Date.UTC(year, monthNumber, 1, 12));
  return formatDate(next.toISOString());
}

/** The cost in US dollars and cents; the contract gives it in micro-dollars (`costMicros`). */
export function formatCost(costMicros: number): string {
  return formatMoney(Math.round(costMicros / 10_000), { currency: 'USD', alwaysShowCents: true });
}

/** A route's parameters as label and value: the ones the console knows first, then the rest. */
export function routeParams(params: RouteRow['params']): { label: string; value: string }[] {
  const known: [string, string, (value: number | string) => string][] = [
    ['maxOutputTokens', m.paramMaxTokens, (value) => formatNumber(Number(value))],
    ['effort', m.paramEffort, (value) => m.effort(String(value))],
    ['timeoutMs', m.paramTimeout, (value) => m.seconds(Number(value) / 1000)],
  ];
  const shown = known.flatMap(([key, label, format]) => {
    const value = params[key];
    return typeof value === 'number' || typeof value === 'string'
      ? [{ label, value: format(value) }]
      : [];
  });
  const others = Object.entries(params)
    .filter(([key]) => !known.some(([knownKey]) => knownKey === key))
    .map(([key, value]) => ({
      label: key,
      value: String(value),
    }));
  return [...shown, ...others];
}

// --- Changes, the edit dialog and the budget form ---

/** The gate's latest decisions, newest first: who allowed or blocked what, with the reference. */
export function gateHistory(gate: readonly GateCellView[]): GateRule[] {
  return rulesOf(gate).sort((a, b) => b.changedAt.localeCompare(a.changedAt));
}

/** Who made a change: their name as the gateway recorded it, else their account id. */
export function changedByText(rule: Pick<GateRule, 'changedBy' | 'changedByName'>): string {
  return rule.changedByName ?? rule.changedBy;
}

export function changeText(rule: Pick<GateRule, 'dataClass' | 'providerClass' | 'allowed'>) {
  const provider = m.providerClass[rule.providerClass];
  const data = m.dataClass[rule.dataClass];
  return rule.allowed ? m.changeAllowed(provider, data) : m.changeBlocked(provider, data);
}

/** The edit dialog's checkboxes, keyed `dataClass|providerClass`. */
export type GateDraft = Record<`${DataClass}|${ProviderClass}`, boolean>;

export function gateDraft(gate: readonly GateCellView[]): GateDraft {
  const draft = {} as GateDraft;
  for (const dataClass of DATA_CLASSES) {
    for (const providerClass of PROVIDER_CLASSES) {
      draft[`${dataClass}|${providerClass}`] = isAllowed(gate, dataClass, providerClass);
    }
  }
  return draft;
}

/** The cells the draft changes, in table order. */
export function gateChanges(gate: readonly GateCellView[], draft: GateDraft): GateChange[] {
  return DATA_CLASSES.flatMap((dataClass) =>
    PROVIDER_CLASSES.flatMap((providerClass) => {
      const allowed = draft[`${dataClass}|${providerClass}`];
      return allowed === isAllowed(gate, dataClass, providerClass)
        ? []
        : [{ dataClass, providerClass, allowed }];
    }),
  );
}

/** A change as the confirm dialog words it. */
export function confirmText(change: GateChange, commission: string): string {
  const provider = m.providerClass[change.providerClass];
  const data = m.dataClass[change.dataClass];
  return change.allowed
    ? m.confirmAllow(provider, data, commission)
    : m.confirmBlock(provider, data, commission);
}

/** `1,500,000` or `1500000` → 1500000; anything else that is not a whole number → null. */
export function parseWholeNumber(text: string): number | null {
  const digits = text.trim().replace(/[,\s]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Seconds as typed, to the millisecond ("12.5", "0.3"), in milliseconds; null unless above 0.
 * A route's timeout is kept in milliseconds, so an untouched field saves what it showed.
 */
export function parseMilliseconds(text: string): number | null {
  const seconds = text.trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(seconds)) return null;
  const ms = Math.round(Number(seconds) * 1000);
  return Number.isSafeInteger(ms) && ms > 0 ? ms : null;
}

export interface BudgetErrors {
  monthlyTokens?: string;
  perMinute?: string;
}

export function budgetErrors(monthlyTokens: string, perMinute: string): BudgetErrors {
  const tokens = parseWholeNumber(monthlyTokens);
  const limit = parseWholeNumber(perMinute);
  return {
    ...(tokens === null ? { monthlyTokens: m.monthlyTokensError } : {}),
    ...(limit === null || limit < 1 ? { perMinute: m.perMinuteError } : {}),
  };
}

/** The budget would be under what is already used this month: requests stop until it resets. */
export function belowUsage(monthlyTokens: string, usage: TenantUsage): boolean {
  const tokens = parseWholeNumber(monthlyTokens);
  return tokens !== null && tokens < usage.tokensUsed;
}

// --- The route dialog ---

export const TASK_NAMES = [
  'summarize-declaration',
  'explain-flags',
  'draft-clarification',
] as const;
export type RouteTask = (typeof TASK_NAMES)[number];
export const EFFORTS = ['low', 'medium', 'high'] as const;

/** The route dialog's fields as typed: numbers as text, effort `''` for the task's own. */
export interface RouteDraft {
  provider: string;
  model: string;
  maxOutputTokens: string;
  effort: '' | (typeof EFFORTS)[number];
  timeoutSeconds: string;
  approvalRef: string;
}

/** A route's fields to edit: as the table shows it, or empty for a new one. */
export function routeDraft(route: RouteRow | null): RouteDraft {
  const number = (value: unknown) => (typeof value === 'number' ? value : null);
  const tokens = number(route?.params.maxOutputTokens);
  const timeout = number(route?.params.timeoutMs);
  const effort = EFFORTS.find((each) => each === route?.params.effort) ?? '';
  return {
    provider: route?.provider ?? '',
    model: route?.model ?? '',
    maxOutputTokens: tokens === null ? '' : String(tokens),
    effort,
    timeoutSeconds: timeout === null ? '' : String(timeout / 1000),
    approvalRef: '',
  };
}

export type RouteErrors = Partial<Record<keyof RouteDraft, string>>;

/** What is wrong with the draft before it is sent; the gateway checks the provider. */
export function routeErrors(draft: RouteDraft): RouteErrors {
  const optionalPositive = (text: string) => {
    if (!text.trim()) return true;
    const value = parseWholeNumber(text);
    return value !== null && value > 0;
  };
  return {
    ...(draft.provider.trim() ? {} : { provider: m.routeProviderRequired }),
    ...(draft.model.trim() ? {} : { model: m.routeModelRequired }),
    ...(optionalPositive(draft.maxOutputTokens) ? {} : { maxOutputTokens: m.routeNumberError }),
    ...(!draft.timeoutSeconds.trim() || parseMilliseconds(draft.timeoutSeconds) !== null
      ? {}
      : { timeoutSeconds: m.routeSecondsError }),
    ...(draft.approvalRef.trim() ? {} : { approvalRef: m.approvalRefRequired }),
  };
}

/** The route the draft describes, in the contract's terms; unset parameters are left out. */
export function routeInput(draft: RouteDraft) {
  const tokens = parseWholeNumber(draft.maxOutputTokens);
  const timeoutMs = parseMilliseconds(draft.timeoutSeconds);
  return {
    provider: draft.provider.trim(),
    model: draft.model.trim(),
    params: {
      ...(tokens ? { maxOutputTokens: tokens } : {}),
      ...(draft.effort ? { effort: draft.effort } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
    },
    approvalRef: draft.approvalRef.trim(),
  };
}
