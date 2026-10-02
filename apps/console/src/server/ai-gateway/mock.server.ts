/**
 * In-memory stand-in for the ai-gateway's policy endpoints (ai-gateway.yaml, tag `policy`), used
 * when AI_GATEWAY_MOCK is set until the gateway implements them (#290). One store for every
 * caller; only platform admins (the token's `realm_access.roles`) get past the 403, as the
 * contract has it. Seeded from the prototype (07c-copilot): the demo tenant, PSC, JSC and the
 * Nairobi City County Public Service Board allow external providers on synthetic data; every
 * other tenant is blocked by default. JSC is at 86% of its budget and Nairobi City has used its
 * budget up; the local directory seed's Example Commission (`ec`) is enabled at 86% too. A tenant the store has not seen reads as blocked, with the default budget.
 *
 * Also answers the review service's Commission AI status (review.yaml `getCommissionAiStatus`,
 * which proxies the gateway's tenant status) from the same store, so a policy saved here shows
 * on the Commission's own policy page (`mockTenantAiStatus`).
 */
import createClient from 'openapi-fetch';

import { isRecord, json, problem, readJson } from '../mock-http';
import type { paths } from './api.gen';
import type { DataClass, GateRule, ProviderClass, Route, TenantUsage } from './types';

const DATA_CLASSES: readonly DataClass[] = ['synthetic', 'restricted', 'highly-confidential'];
const PROVIDER_CLASSES: readonly ProviderClass[] = ['external', 'self-hosted'];

/** The default budget of a tenant the gateway has not been told about. */
const DEFAULT_BUDGET = { monthlyTokens: 1_000_000, perMinute: 60 };

type Counters = Omit<TenantUsage, 'tenant' | 'month'>;

interface StoredTenant {
  rules: GateRule[];
  usage: Counters;
}

const tenants = new Map<string, StoredTenant>();

function counters(
  monthlyTokens: number,
  perMinute: number,
  tokensUsed: number,
  costMicros: number,
  jobs: number,
  blocked: number,
  failed: number,
): Counters {
  return { monthlyTokens, perMinute, tokensUsed, costMicros, jobs, blocked, failed };
}

function allowSynthetic(approvalRef: string, changedAt: string): GateRule {
  return {
    dataClass: 'synthetic',
    providerClass: 'external',
    allowed: true,
    approvalRef,
    changedBy: 'Amina Wanjiru',
    changedAt,
  };
}

/** Requests a tenant blocked by policy has had refused, made up but stable per slug. */
function blockedCount(slug: string): number {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return hash % 90;
}

/** Back to the seeded store. */
export function resetAiGatewayMock() {
  tenants.clear();
  const seed: Record<string, StoredTenant> = {
    demo: {
      rules: [allowSynthetic('EACC/AI/2026/001', '2026-08-04T06:12:00Z')],
      usage: counters(2_000_000, 60, 412_800, 5_210_000, 318, 0, 2),
    },
    psc: {
      rules: [allowSynthetic('EACC/AI/2026/014', '2026-09-01T08:40:00Z')],
      usage: counters(3_000_000, 120, 1_926_400, 24_180_000, 1_482, 0, 11),
    },
    jsc: {
      rules: [allowSynthetic('EACC/AI/2026/019', '2026-09-08T12:05:00Z')],
      usage: counters(1_000_000, 60, 862_300, 10_940_000, 604, 0, 3),
    },
    cpsbnairobicity: {
      rules: [allowSynthetic('EACC/AI/2026/021', '2026-09-10T07:20:00Z')],
      usage: counters(1_500_000, 60, 1_500_000, 18_820_000, 1_120, 37, 5),
    },
    tsc: { rules: [], usage: counters(1_000_000, 60, 0, 0, 0, 214, 0) },
    // The local directory seed's Example Commission, so a dev stack shows a budget near its end.
    ec: {
      rules: [allowSynthetic('EACC/AI/2026/023', '2026-09-15T09:30:00Z')],
      usage: counters(500_000, 30, 431_000, 5_460_000, 287, 0, 1),
    },
  };
  for (const [slug, tenant] of Object.entries(seed)) tenants.set(slug, tenant);
}

function tenantOf(slug: string): StoredTenant {
  let tenant = tenants.get(slug);
  if (!tenant) {
    tenant = {
      rules: [],
      usage: counters(
        DEFAULT_BUDGET.monthlyTokens,
        DEFAULT_BUDGET.perMinute,
        0,
        0,
        0,
        blockedCount(slug),
        0,
      ),
    };
    tenants.set(slug, tenant);
  }
  return tenant;
}

const ROUTES: Route[] = [
  route(null, 'summarize-declaration', 0, 4_000, 60_000),
  route(null, 'explain-flags', 0, 3_000, 45_000),
  route(null, 'draft-clarification', 0.2, 2_000, 10_000),
  route('psc', 'draft-clarification', 0.2, 3_000, 10_000),
  route(null, 'extract-document', 0, 2_000, 60_000),
  route(null, 'answer-declarant-question', 0.3, 1_500, 30_000),
  route(null, 'narrate-compliance-report', 0.2, 6_000, 120_000),
];

function route(
  tenant: string | null,
  task: Route['task'],
  temperature: number,
  maxTokens: number,
  timeoutMs: number,
): Route {
  return {
    tenant,
    task,
    provider: 'anthropic',
    model: 'claude-opus-5',
    params: { temperature, maxTokens, timeoutMs },
  };
}

/** The month usage is counted in, as the gateway would report it (Nairobi time). */
function currentMonth(): string {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7);
}

function usageOf(slug: string): TenantUsage {
  return { tenant: slug, month: currentMonth(), ...tenantOf(slug).usage };
}

/** What the review service's Commission AI status says for `slug` (review.yaml). */
export function mockTenantAiStatus(slug: string): {
  enabled: boolean;
  providerClass: ProviderClass | null;
  dataClasses: DataClass[];
} {
  ensureSeeded();
  const allowed = tenantOf(slug).rules.filter((rule) => rule.allowed);
  const providerClass =
    PROVIDER_CLASSES.find((each) => allowed.some((rule) => rule.providerClass === each)) ?? null;
  return {
    enabled: providerClass !== null,
    providerClass,
    dataClasses: DATA_CLASSES.filter((each) =>
      allowed.some((rule) => rule.providerClass === providerClass && rule.dataClass === each),
    ),
  };
}

interface Caller {
  name: string;
  roles: string[];
}

/** The caller from the token's claims; the mock does not verify it, the gateway would. */
function callerOf(request: Request): Caller {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    if (!isRecord(claims)) return { name: 'Unknown', roles: [] };
    const access = claims.realm_access;
    const roles = isRecord(access) && Array.isArray(access.roles) ? access.roles : [];
    return {
      name: typeof claims.name === 'string' ? claims.name : 'Unknown',
      roles: roles.filter((role): role is string => typeof role === 'string'),
    };
  } catch {
    return { name: 'Unknown', roles: [] };
  }
}

/** An unsigned token with the claims the mock reads, for tests. */
export function mockToken(name: string, roles: readonly string[]): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ name, realm_access: { roles } })}.`;
}

/** A gateway client answered by this mock, as `name` holding `roles`, for tests. */
export function mockAiGatewayClient(name: string, roles: readonly string[]) {
  return createClient<paths>({
    baseUrl: 'http://ai-gateway.test',
    headers: { authorization: `Bearer ${mockToken(name, roles)}` },
    fetch: mockAiGatewayFetch,
  });
}

function validation(errors: { path: string; message: string }[]) {
  return json(400, {
    type: 'https://adili.go.ke/problems/validation',
    title: 'Request failed validation',
    status: 400,
    errors,
  });
}

function ensureSeeded() {
  if (tenants.size === 0) resetAiGatewayMock();
}

export async function mockAiGatewayFetch(request: Request): Promise<Response> {
  ensureSeeded();
  const { pathname } = new URL(request.url);
  const { method } = request;
  const caller = callerOf(request);
  if (!caller.roles.includes('platform-admin')) {
    return problem(403, 'Only platform administrators can see AI policy');
  }

  if (method === 'GET' && pathname === '/v1/ai/policies') {
    return json(
      200,
      [...tenants.entries()].map(([tenant, stored]) => ({ tenant, rules: stored.rules })),
    );
  }

  const policy = /^\/v1\/ai\/policies\/([a-z][a-z0-9]{1,19})$/.exec(pathname);
  if (method === 'PUT' && policy?.[1]) {
    return setGatePolicy(request, policy[1], caller);
  }

  if (method === 'GET' && pathname === '/v1/ai/routing') return json(200, ROUTES);

  const usage = /^\/v1\/ai\/tenants\/([a-z][a-z0-9]{1,19})\/usage$/.exec(pathname);
  if (usage?.[1]) {
    if (method === 'GET') return json(200, usageOf(usage[1]));
    if (method === 'PUT') return setBudget(request, usage[1]);
  }

  return problem(404, 'Not found');
}

async function setGatePolicy(request: Request, slug: string, caller: Caller) {
  const body = await readJson(request);
  const input = isRecord(body) ? body : {};
  const errors: { path: string; message: string }[] = [];
  const dataClass = DATA_CLASSES.find((each) => each === input.dataClass);
  const providerClass = PROVIDER_CLASSES.find((each) => each === input.providerClass);
  const approvalRef = typeof input.approvalRef === 'string' ? input.approvalRef.trim() : '';
  if (!dataClass) errors.push({ path: '/dataClass', message: 'Unknown data class' });
  if (!providerClass) errors.push({ path: '/providerClass', message: 'Unknown provider class' });
  if (typeof input.allowed !== 'boolean') {
    errors.push({ path: '/allowed', message: 'Must be true or false' });
  }
  if (approvalRef.length < 1 || approvalRef.length > 200) {
    errors.push({ path: '/approvalRef', message: 'Enter the approval reference' });
  }
  if (!dataClass || !providerClass || errors.length > 0) return validation(errors);

  const tenant = tenantOf(slug);
  tenant.rules = [
    ...tenant.rules.filter(
      (rule) => !(rule.dataClass === dataClass && rule.providerClass === providerClass),
    ),
    {
      dataClass,
      providerClass,
      allowed: input.allowed === true,
      approvalRef,
      changedBy: caller.name,
      changedAt: new Date().toISOString(),
    },
  ];
  return json(200, { tenant: slug, rules: tenant.rules });
}

async function setBudget(request: Request, slug: string) {
  const body = await readJson(request);
  const input = isRecord(body) ? body : {};
  const { monthlyTokens, perMinute } = input;
  const errors: { path: string; message: string }[] = [];
  if (typeof monthlyTokens !== 'number' || !Number.isInteger(monthlyTokens) || monthlyTokens < 0) {
    errors.push({ path: '/monthlyTokens', message: 'Must be a whole number, 0 or more' });
  }
  if (typeof perMinute !== 'number' || !Number.isInteger(perMinute) || perMinute < 1) {
    errors.push({ path: '/perMinute', message: 'Must be a whole number, 1 or more' });
  }
  if (typeof monthlyTokens !== 'number' || typeof perMinute !== 'number' || errors.length > 0) {
    return validation(errors);
  }
  const tenant = tenantOf(slug);
  tenant.usage = { ...tenant.usage, monthlyTokens, perMinute };
  return json(200, usageOf(slug));
}
