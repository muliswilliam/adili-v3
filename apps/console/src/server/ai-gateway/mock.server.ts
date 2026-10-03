/**
 * In-memory stand-in for the ai-gateway's policy endpoints (ai-gateway.yaml, tag `policy`), used
 * when AI_GATEWAY_MOCK is set, so the console runs without the gateway. One store for every
 * caller; only platform admins (the token's `realm_access.roles`) get past the 403, as the
 * contract has it. Seeded from the prototype (07c-copilot): the gateway's default gate (external
 * providers see nothing), the demo tenant, PSC, JSC and the Nairobi City County Public Service
 * Board with recorded approvals letting them see synthetic data, and TSC blocking it by
 * resolution. JSC is
 * at 86% of its budget and Nairobi City has used its budget up; the local directory seed's
 * Example Commission (`ec`) is at 86% too. A tenant the store has not seen has the default gate
 * and budget, and no usage.
 *
 * Also answers the review service's Commission AI status (review.yaml `getCommissionAiStatus`,
 * which reads the gateway's tenant status) from the same store, so a policy saved here shows on
 * the Commission's own policy page (`mockTenantAiStatus`). Routes can be set and removed as the
 * gateway does, to the one provider it reaches (`anthropic`).
 */
import createClient from 'openapi-fetch';

import { isRecord, json, mockCallerOf, problem, readJson, unsignedMockToken } from '../mock-http';
import type { paths } from './api.gen';
import { isCommissionTask, TASK_NAMES } from './tasks';
import type {
  DataClass,
  GateRule,
  GateRuleInput,
  ProviderClass,
  Route,
  TenantUsage,
} from './types';

const DATA_CLASSES: readonly DataClass[] = ['synthetic', 'restricted', 'highly-confidential'];
const PROVIDER_CLASSES: readonly ProviderClass[] = ['external', 'self-hosted'];

/** The gateway's default gate: self-hosted providers see everything, external nothing. */
const DEFAULT_GATE: GateRuleInput[] = DATA_CLASSES.flatMap((dataClass) =>
  PROVIDER_CLASSES.map((providerClass) => ({
    dataClass,
    providerClass,
    allowed: providerClass === 'self-hosted',
  })),
);

/** The default budget of a tenant without one of its own. */
const DEFAULT_BUDGET = { monthlyTokens: 1_000_000, perMinute: 60 };

/**
 * Commissions whose declarations are demo data, so the review service sends them as `synthetic`
 * (its AI_SYNTHETIC_DATA_TENANTS); every other Commission's go as `highly-confidential`.
 */
const SYNTHETIC_DATA_TENANTS = new Set(['demo', 'psc', 'jsc', 'cpsbnairobicity', 'ec']);

type Counters = Omit<TenantUsage, 'tenant' | 'month'>;

/** What the gateway knows of a tenant: its own rules, and its budget and usage once it has any. */
interface StoredTenant {
  rules: GateRule[];
  usage: Counters | null;
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

function syntheticRule(allowed: boolean, approvalRef: string, changedAt: string): GateRule {
  return {
    dataClass: 'synthetic',
    providerClass: 'external',
    allowed,
    tasks: null,
    approvalRef,
    changedBy: '7d1c2a4e-0000-4000-8000-00000000a001',
    changedByName: 'Amina Wanjiru',
    changedAt,
  };
}

/** Back to the seeded store. */
export function resetAiGatewayMock() {
  tenants.clear();
  routes.splice(0, routes.length, ...SEED_ROUTES);
  const seed: Record<string, StoredTenant> = {
    demo: {
      rules: [syntheticRule(true, 'EACC/AI/2026/001', '2026-08-04T06:12:00Z')],
      usage: counters(2_000_000, 60, 412_800, 5_210_000, 318, 0, 2),
    },
    psc: {
      rules: [
        syntheticRule(true, 'EACC/AI/2026/014', '2026-09-01T08:40:00Z'),
        // As `pnpm db:seed` records it: the demo reads synthetic documents into the form.
        {
          ...syntheticRule(
            true,
            'Demo set-up: synthetic documents read into the form only (spec 05b)',
            '2026-10-03T09:00:00Z',
          ),
          dataClass: 'highly-confidential',
          tasks: ['extract-document'],
          changedBy: 'system:demo-seed',
          changedByName: 'Demo seed',
        },
      ],
      usage: counters(3_000_000, 120, 1_926_400, 24_180_000, 1_482, 0, 11),
    },
    jsc: {
      rules: [syntheticRule(true, 'EACC/AI/2026/019', '2026-09-08T12:05:00Z')],
      usage: counters(1_000_000, 60, 862_300, 10_940_000, 604, 0, 3),
    },
    cpsbnairobicity: {
      rules: [syntheticRule(true, 'EACC/AI/2026/021', '2026-09-10T07:20:00Z')],
      usage: counters(1_500_000, 60, 1_500_000, 18_820_000, 1_120, 37, 5),
    },
    tsc: {
      rules: [syntheticRule(false, 'TSC resolution 12/2026', '2026-09-12T10:00:00Z')],
      usage: counters(1_000_000, 60, 0, 0, 214, 214, 0),
    },
    // The local directory seed's Example Commission, so a dev stack shows a budget near its end.
    ec: {
      rules: [syntheticRule(true, 'EACC/AI/2026/023', '2026-09-15T09:30:00Z')],
      usage: counters(500_000, 30, 431_000, 5_460_000, 287, 0, 1),
    },
  };
  for (const [slug, tenant] of Object.entries(seed)) tenants.set(slug, tenant);
}

function tenantOf(slug: string): StoredTenant {
  let tenant = tenants.get(slug);
  if (!tenant) {
    tenant = { rules: [], usage: null };
    tenants.set(slug, tenant);
  }
  return tenant;
}

/** The providers the mock gateway reaches; a route to any other is refused, as the gateway does. */
const PROVIDERS: Record<string, ProviderClass> = { anthropic: 'external' };

/** Stored routes; summarize-declaration has no default route, so it shows the configured one. */
const SEED_ROUTES: Route[] = [
  route(null, 'explain-flags', 3_000, 45_000),
  route(null, 'draft-clarification', 2_000, 10_000),
  route('psc', 'draft-clarification', 3_000, 10_000),
];

/** The routing table; reset with the rest of the store. */
const routes: Route[] = [];

function route(
  tenant: string | null,
  task: Route['task'],
  maxOutputTokens: number,
  timeoutMs: number,
): Route {
  return {
    tenant,
    task,
    provider: 'anthropic',
    providerClass: 'external',
    model: 'claude-opus-5-5',
    params: { maxOutputTokens, timeoutMs },
    configured: false,
  };
}

/**
 * The effective table, as the gateway lists it: the stored routes, then the configured one of
 * every task without a default route.
 */
function routingTable(): Route[] {
  const defaults = new Set(routes.filter((each) => each.tenant === null).map((each) => each.task));
  return [
    ...routes,
    ...TASK_NAMES.filter((task) => !defaults.has(task)).map((task): Route => ({
      tenant: null,
      task,
      provider: 'anthropic',
      providerClass: 'external',
      model: 'claude-opus-5-5',
      params: {},
      configured: true,
    })),
  ];
}

/** The month usage is counted in, as the gateway would report it (Nairobi time). */
function currentMonth(): string {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7);
}

function usageOf(slug: string): TenantUsage {
  return {
    tenant: slug,
    month: currentMonth(),
    ...(tenantOf(slug).usage ??
      counters(DEFAULT_BUDGET.monthlyTokens, DEFAULT_BUDGET.perMinute, 0, 0, 0, 0, 0)),
  };
}

/**
 * The tenant's gate for every cell, for its reviewer tasks: its rule where it has one for every
 * task, else the default (a rule for some tasks only, such as document reading, decides nothing
 * here, as in the gateway's tenant status).
 */
function gateOf(slug: string): GateRuleInput[] {
  const { rules } = tenantOf(slug);
  return DEFAULT_GATE.map(
    (cell) =>
      rules.find(
        (rule) =>
          rule.dataClass === cell.dataClass &&
          rule.providerClass === cell.providerClass &&
          rule.tasks === null,
      ) ?? cell,
  );
}

/**
 * What the review service's Commission AI status says for `slug` (review.yaml): the gateway's
 * tenant status for its routes (all external here), enabled when the Commission's data class is
 * among the data classes the gate lets through.
 */
export function mockTenantAiStatus(slug: string): {
  enabled: boolean;
  providerClass: ProviderClass | null;
  provider: string | null;
  dataClasses: DataClass[];
} {
  ensureSeeded();
  const providerClass: ProviderClass = 'external';
  const gate = gateOf(slug);
  const dataClasses = DATA_CLASSES.filter((dataClass) =>
    gate.some(
      (cell) =>
        cell.dataClass === dataClass && cell.providerClass === providerClass && cell.allowed,
    ),
  );
  const sent: DataClass = SYNTHETIC_DATA_TENANTS.has(slug) ? 'synthetic' : 'highly-confidential';
  return { enabled: dataClasses.includes(sent), providerClass, provider: 'anthropic', dataClasses };
}

interface Caller {
  subject: string;
  name: string | null;
  roles: string[];
}

/** The caller from the token's claims; the mock does not verify it, the gateway would. */
function callerOf(request: Request): Caller {
  const caller = mockCallerOf(request);
  return { ...caller, subject: caller.subject ?? 'unknown' };
}

/** An unsigned token with the claims the mock reads, for tests. */
export function mockToken(name: string, roles: readonly string[]): string {
  return unsignedMockToken({
    subject: `user-${name.toLowerCase().replace(/\W+/g, '-')}`,
    name,
    roles,
  });
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
    return json(200, {
      defaults: DEFAULT_GATE,
      tenants: [...tenants.entries()]
        .filter(([, stored]) => stored.rules.length > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tenant, stored]) => ({ tenant, rules: sortRules(stored.rules) })),
    });
  }

  const policy = /^\/v1\/ai\/policies\/([a-z][a-z0-9]{1,19})$/.exec(pathname);
  if (method === 'PUT' && policy?.[1]) {
    return setGatePolicy(request, policy[1], caller);
  }

  if (method === 'GET' && pathname === '/v1/ai/routing') return json(200, routingTable());

  const routing = /^\/v1\/ai\/(?:tenants\/([a-z][a-z0-9]{1,19})\/)?routing\/([a-z-]+)$/.exec(
    pathname,
  );
  const task = TASK_NAMES.find((each) => each === routing?.[2]);
  if (routing && task) {
    const tenant = routing[1] ?? null;
    if (method === 'PUT') return setRoute(request, tenant, task);
    if (method === 'DELETE') return removeRoute(request, tenant, task);
  }

  if (method === 'GET' && pathname === '/v1/ai/usage') {
    return json(200, {
      month: currentMonth(),
      defaults: DEFAULT_BUDGET,
      tenants: [...tenants.entries()]
        .filter(([, stored]) => stored.usage !== null)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tenant]) => usageOf(tenant)),
    });
  }

  const usage = /^\/v1\/ai\/tenants\/([a-z][a-z0-9]{1,19})\/usage$/.exec(pathname);
  if (usage?.[1]) {
    if (method === 'GET') return json(200, usageOf(usage[1]));
    if (method === 'PUT') return setBudget(request, usage[1]);
  }

  return problem(404, 'Not found');
}

/** Sets the route of a task for every tenant (null) or one, as `PUT .../routing/{task}`. */
async function setRoute(request: Request, tenant: string | null, task: Route['task']) {
  const body = await readJson(request);
  const input = isRecord(body) ? body : {};
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const provider = text(input.provider);
  const model = text(input.model);
  const approvalRef = text(input.approvalRef);
  const params = isRecord(input.params) ? input.params : {};
  const errors: { path: string; message: string }[] = [];
  if (!(provider in PROVIDERS)) {
    errors.push({ path: 'provider', message: 'Must be a provider this gateway reaches' });
  }
  if (model.length < 1 || model.length > 200) errors.push({ path: 'model', message: 'Required' });
  if (approvalRef.length < 1 || approvalRef.length > 200) {
    errors.push({ path: 'approvalRef', message: 'Enter the approval reference' });
  }
  if (errors.length > 0) return validation(errors);
  // As the gateway: no Commission calls an EACC task, so it has no Commission's own route.
  if (tenant !== null && !isCommissionTask(task)) {
    return validation([{ path: 'task', message: 'Must be a task a Commission calls' }]);
  }
  const next: Route = {
    tenant,
    task,
    provider,
    providerClass: PROVIDERS[provider] ?? null,
    model,
    params: params,
    configured: false,
  };
  const index = routes.findIndex((each) => each.task === task && each.tenant === tenant);
  if (index === -1) routes.push(next);
  else routes[index] = next;
  return json(200, next);
}

/** Removes a task's route, as `DELETE .../routing/{task}?approvalRef=`. */
function removeRoute(request: Request, tenant: string | null, task: Route['task']) {
  const approvalRef = new URL(request.url).searchParams.get('approvalRef')?.trim() ?? '';
  if (!approvalRef) return validation([{ path: 'approvalRef', message: 'Required' }]);
  const index = routes.findIndex((each) => each.task === task && each.tenant === tenant);
  if (index === -1) return problem(404, 'There is no such route.');
  routes.splice(index, 1);
  return new Response(null, { status: 204 });
}

/** Rules in the contract's order: data class, then provider class. */
function sortRules(rules: readonly GateRule[]): GateRule[] {
  const rank = (rule: GateRule) =>
    DATA_CLASSES.indexOf(rule.dataClass) * PROVIDER_CLASSES.length +
    PROVIDER_CLASSES.indexOf(rule.providerClass);
  return [...rules].sort((a, b) => rank(a) - rank(b));
}

/** Every rule or none, as the gateway applies them in one transaction. */
async function setGatePolicy(request: Request, slug: string, caller: Caller) {
  const body = await readJson(request);
  const input = isRecord(body) ? body : {};
  const errors: { path: string; message: string }[] = [];
  const approvalRef = typeof input.approvalRef === 'string' ? input.approvalRef.trim() : '';
  const rawRules = Array.isArray(input.rules) ? input.rules : [];
  const rules: GateRuleInput[] = [];
  if (rawRules.length < 1 || rawRules.length > 6) {
    errors.push({ path: '/rules', message: 'Send 1 to 6 rules' });
  }
  rawRules.forEach((raw: unknown, index) => {
    const rule = isRecord(raw) ? raw : {};
    const dataClass = DATA_CLASSES.find((each) => each === rule.dataClass);
    const providerClass = PROVIDER_CLASSES.find((each) => each === rule.providerClass);
    if (!dataClass)
      errors.push({ path: `/rules/${String(index)}/dataClass`, message: 'Unknown data class' });
    if (!providerClass) {
      errors.push({
        path: `/rules/${String(index)}/providerClass`,
        message: 'Unknown provider class',
      });
    }
    if (typeof rule.allowed !== 'boolean') {
      errors.push({ path: `/rules/${String(index)}/allowed`, message: 'Must be true or false' });
    }
    if (dataClass && providerClass) {
      if (
        rules.some((each) => each.dataClass === dataClass && each.providerClass === providerClass)
      ) {
        errors.push({
          path: '/rules',
          message: 'At most one rule per data class and provider class',
        });
      }
      // As the gateway: a list of tasks it runs, null for every task, or left out.
      let tasks: GateRuleInput['tasks'];
      if (Array.isArray(rule.tasks)) {
        const named = rule.tasks as unknown[];
        tasks = TASK_NAMES.filter((task) => named.includes(task));
        if (named.length === 0 || tasks.length !== named.length) {
          errors.push({ path: `/rules/${String(index)}/tasks`, message: 'Unknown task' });
        }
      } else if (rule.tasks === null) {
        tasks = null;
      } else if (rule.tasks !== undefined) {
        errors.push({ path: `/rules/${String(index)}/tasks`, message: 'Must be a list of tasks' });
      }
      // A rule for some tasks only is widened on purpose (`tasks: null`), never silently.
      const before = tenantOf(slug).rules.find(
        (each) => each.dataClass === dataClass && each.providerClass === providerClass,
      );
      if (before?.tasks && tasks === undefined) {
        errors.push({
          path: `/rules/${String(index)}/tasks`,
          message: 'The rule is for some tasks only: send tasks, or null for every task',
        });
      }
      rules.push({ dataClass, providerClass, allowed: rule.allowed === true, tasks });
    }
  });
  if (approvalRef.length < 1 || approvalRef.length > 200) {
    errors.push({ path: '/approvalRef', message: 'Enter the approval reference' });
  }
  if (errors.length > 0) return validation(errors);

  const tenant = tenantOf(slug);
  const changedAt = new Date().toISOString();
  for (const rule of rules) {
    tenant.rules = [
      ...tenant.rules.filter(
        (each) => !(each.dataClass === rule.dataClass && each.providerClass === rule.providerClass),
      ),
      {
        ...rule,
        tasks: rule.tasks === undefined ? null : rule.tasks,
        approvalRef,
        changedBy: caller.subject,
        changedByName: caller.name,
        changedAt,
      },
    ];
  }
  return json(200, { tenant: slug, rules: sortRules(tenant.rules) });
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
  tenant.usage = { ...usageOf(slug), monthlyTokens, perMinute };
  return json(200, usageOf(slug));
}
