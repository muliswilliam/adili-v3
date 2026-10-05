/**
 * In-memory stand-in for the audit service's trail (audit.yaml), used when AUDIT_MOCK is set, so
 * the auditor's pages run without the service. Only auditors (the token's `realm_access.roles`)
 * get past the 403, as the contract has it. Seeded with the demo's flows over the last two days:
 * a PSC reviewer opening Wanjiku Kamau's case and its copilot, her declaration submitted and
 * acknowledged, a Form K decided and its package downloaded, public verify lookups, a demo role
 * switch and an auditor's own search. Every chain verifies intact; today's are not anchored yet.
 */
import { createHash } from 'node:crypto';

import createClient from 'openapi-fetch';

import { json, mockCallerOf, problem, unsignedMockToken } from '../mock-http';
import type { paths } from './api.gen';
import type {
  AuditChain,
  AuditChainVerification,
  AuditEvent,
  AuditEventSummary,
  AuditKind,
} from './types';

const WANJIKU = '7d3f9b2a-4c1e-4f8a-9b6d-2e5a1c3f7b90';
const REVIEWER = '5b1f0a7e-2c3d-4e5f-8a9b-0c1d2e3f4a5b';
const ACCESS_OFFICER = '9e8d7c6b-5a4f-4e3d-2c1b-0a9f8e7d6c5b';
const AUDITOR = '3c2b1a0f-9e8d-4c7b-6a5f-4e3d2c1b0a9f';
const CASE_ID = '0192f1c4-7a10-7c3e-9d41-5be0a2c4e6f8';
const DECLARATION_ID = '0192f1c4-6b20-7a1d-8e32-4cd1b3e5f709';
const REQUEST_ID = '0192f1c4-8c30-7b2e-9f43-6de2c4f6a81a';

const sha = (input: string) => createHash('sha256').update(input).digest('hex');

interface Seed {
  minutesAgo: number;
  kind: AuditKind;
  action: string;
  eventType: string;
  tenant: string;
  source: string;
  actor: AuditEventSummary['actor'];
  resource: AuditEventSummary['resource'];
  legalBasis?: AuditEventSummary['legalBasis'];
  recipient?: string | null;
  request?: AuditEvent['request'];
  data: Record<string, unknown>;
}

const reviewer: AuditEventSummary['actor'] = {
  type: 'user',
  id: REVIEWER,
  clientId: 'console',
  tenant: 'psc',
  roles: ['reviewer'],
  onBehalfOf: null,
};
const service = (name: string): AuditEventSummary['actor'] => ({
  type: 'service',
  id: `adili/${name}`,
  clientId: null,
  tenant: null,
  roles: [],
  onBehalfOf: null,
});

const SEEDS: Seed[] = [
  {
    minutesAgo: 1_700,
    kind: 'write',
    action: 'declaration.submitted',
    eventType: 'declaration.submitted.v1',
    tenant: 'psc',
    source: 'adili/declarations',
    actor: service('declarations'),
    resource: { type: 'declaration', id: DECLARATION_ID, subjectPersonId: WANJIKU },
    data: { declarationId: DECLARATION_ID, personId: WANJIKU, version: 1 },
  },
  {
    minutesAgo: 1_698,
    kind: 'write',
    action: 'document.issued',
    eventType: 'document.issued.v1',
    tenant: 'psc',
    source: 'adili/documents',
    actor: service('documents'),
    resource: { type: 'document', id: 'ADL-7Q4K-M2XR-9HTC', subjectPersonId: null },
    data: { documentType: 'acknowledgement-slip', verificationId: 'ADL-7Q4K-M2XR-9HTC' },
  },
  {
    minutesAgo: 1_640,
    kind: 'verification',
    action: 'document.verified',
    eventType: 'audit.verification.v1',
    tenant: 'platform',
    source: 'adili/verification-api',
    actor: { ...service('verification-api'), type: 'anonymous', id: '197.248.16.0/24' },
    resource: { type: 'document', id: 'ADL-7Q4K-M2XR-9HTC', subjectPersonId: null },
    data: { verificationId: 'ADL-7Q4K-M2XR-9HTC', outcome: 'valid' },
  },
  {
    minutesAgo: 240,
    kind: 'read',
    action: 'review.case.viewed',
    eventType: 'audit.read.v1',
    tenant: 'psc',
    source: 'adili/review',
    actor: reviewer,
    resource: { type: 'review-case', id: CASE_ID, subjectPersonId: WANJIKU },
    legalBasis: { basis: 'review-case', reference: CASE_ID },
    request: { method: 'GET', route: '/v1/review/cases/:caseId' },
    data: { action: 'review.case.viewed' },
  },
  {
    minutesAgo: 238,
    kind: 'read',
    action: 'review.copilot.viewed',
    eventType: 'audit.read.v1',
    tenant: 'psc',
    source: 'adili/review',
    actor: reviewer,
    resource: { type: 'review-case', id: CASE_ID, subjectPersonId: WANJIKU },
    legalBasis: { basis: 'review-case', reference: CASE_ID },
    request: { method: 'GET', route: '/v1/review/cases/:caseId/copilot' },
    data: { action: 'review.copilot.viewed' },
  },
  {
    minutesAgo: 230,
    kind: 'read',
    action: 'declaration.version.viewed',
    eventType: 'audit.read.v1',
    tenant: 'psc',
    source: 'adili/declarations',
    actor: { ...reviewer, clientId: 'review', onBehalfOf: REVIEWER },
    resource: { type: 'declaration-version', id: DECLARATION_ID, subjectPersonId: WANJIKU },
    legalBasis: { basis: 'review-case', reference: CASE_ID },
    request: { method: 'GET', route: '/internal/v1/declarations/:declarationId/versions/:version' },
    data: { action: 'declaration.version.viewed' },
  },
  {
    minutesAgo: 200,
    kind: 'write',
    action: 'review.clarification.issued',
    eventType: 'review.clarification.issued.v1',
    tenant: 'psc',
    source: 'adili/review',
    actor: service('review'),
    resource: { type: 'review', id: CASE_ID, subjectPersonId: WANJIKU },
    data: { caseId: CASE_ID, personId: WANJIKU },
  },
  {
    minutesAgo: 120,
    kind: 'write',
    action: 'access.request.decided',
    eventType: 'access.request.decided.v1',
    tenant: 'psc',
    source: 'adili/access',
    actor: service('access'),
    resource: { type: 'access', id: REQUEST_ID, subjectPersonId: WANJIKU },
    data: { requestId: REQUEST_ID, outcome: 'grant', personId: WANJIKU },
  },
  {
    minutesAgo: 95,
    kind: 'read',
    action: 'access.package.downloaded',
    eventType: 'audit.read.v1',
    tenant: 'psc',
    source: 'adili/access',
    actor: {
      type: 'user',
      id: ACCESS_OFFICER,
      clientId: 'portal',
      tenant: null,
      roles: ['applicant'],
      onBehalfOf: null,
    },
    resource: { type: 'access-request', id: REQUEST_ID, subjectPersonId: WANJIKU },
    legalBasis: { basis: 'act-s36-1', reference: 'ARQ-PSC-2026-0000014-H' },
    recipient: 'Njoki Wambua',
    request: { method: 'GET', route: '/v1/access/requests/:requestId/package' },
    data: { action: 'access.package.downloaded' },
  },
  {
    minutesAgo: 30,
    kind: 'auth',
    action: 'demo.account-switched',
    eventType: 'audit.demo-switch.v1',
    tenant: 'platform',
    source: 'adili/console',
    actor: { ...reviewer, clientId: 'console' },
    resource: { type: 'account', id: 'supervisor', subjectPersonId: null },
    data: { app: 'console', to: { username: 'supervisor' } },
  },
  {
    minutesAgo: 5,
    kind: 'read',
    action: 'audit.events.searched',
    eventType: 'audit.read.v1',
    tenant: 'eacc',
    source: 'adili/audit',
    actor: {
      type: 'user',
      id: AUDITOR,
      clientId: 'console',
      tenant: 'eacc',
      roles: ['auditor'],
      onBehalfOf: null,
    },
    resource: { type: 'audit-event', id: null, subjectPersonId: null },
    request: { method: 'GET', route: '/v1/audit/events' },
    data: { action: 'audit.events.searched' },
  },
];

interface Stored extends AuditEvent {
  /** For ordering: newest first. */
  at: number;
}

function buildStore(now: number): Stored[] {
  const seqs = new Map<string, number>();
  const heads = new Map<string, string>();
  return SEEDS.map((seed, index) => {
    const at = now - seed.minutesAgo * 60_000;
    const occurredAt = new Date(at).toISOString();
    const chainDay = occurredAt.slice(0, 10);
    const chain = `${seed.tenant}:${chainDay}`;
    const seq = (seqs.get(chain) ?? 0) + 1;
    seqs.set(chain, seq);
    const prevHash = heads.get(chain) ?? '0'.repeat(64);
    const hash = sha(`${prevHash}${String(index)}`);
    heads.set(chain, hash);
    return {
      at,
      eventId: `0192f1c4-${String(1000 + index)}-7000-8000-${String(index).padStart(12, '0')}`,
      eventType: seed.eventType,
      kind: seed.kind,
      action: seed.action,
      occurredAt,
      recordedAt: occurredAt,
      tenant: seed.tenant,
      actor: seed.actor,
      resource: seed.resource,
      outcome: 'success' as const,
      legalBasis: seed.legalBasis ?? null,
      recipient: seed.recipient ?? null,
      source: seed.source,
      request: seed.request ?? null,
      traceparent: null,
      data: seed.data,
      chain: { chainDay, seq, hashVersion: 1, prevHash, hash },
    };
  }).sort((a, b) => b.at - a.at);
}

let store: Stored[] | null = null;
function events(): Stored[] {
  store ??= buildStore(Date.now());
  return store;
}

/** Forgets the store, so the next request seeds it again relative to now (tests). */
export function resetAuditMock() {
  store = null;
}

function summary(event: Stored): AuditEventSummary {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    kind: event.kind,
    action: event.action,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    tenant: event.tenant,
    actor: event.actor,
    resource: event.resource,
    outcome: event.outcome,
    legalBasis: event.legalBasis,
    recipient: event.recipient,
    source: event.source,
  };
}

function chains(): AuditChain[] {
  const today = new Date().toISOString().slice(0, 10);
  const byChain = new Map<string, Stored[]>();
  for (const event of events()) {
    const key = `${event.tenant}|${event.chain.chainDay}`;
    byChain.set(key, [...(byChain.get(key) ?? []), event]);
  }
  return [...byChain.entries()]
    .map(([key, list]) => {
      const [tenant = '', chainDay = ''] = key.split('|');
      const head = list.reduce((a, b) => (a.chain.seq > b.chain.seq ? a : b));
      return {
        tenant,
        chainDay,
        events: list.length,
        headHash: head.chain.hash,
        anchor:
          chainDay < today
            ? {
                merkleRoot: sha(`root:${key}`),
                anchoredAt: `${chainDay}T21:30:04.000Z`,
                objectKey: `anchors/${tenant}/${chainDay}.json`,
              }
            : null,
      };
    })
    .sort((a, b) =>
      a.chainDay === b.chainDay
        ? a.tenant.localeCompare(b.tenant)
        : a.chainDay < b.chainDay
          ? 1
          : -1,
    );
}

/** Answers a request to the audit service's trail as the service would. */
export function mockAuditFetch(request: Request): Promise<Response> {
  return Promise.resolve(answer(request));
}

function answer(request: Request): Response {
  const url = new URL(request.url);
  if (request.method !== 'GET') return problem(405, 'Method Not Allowed');
  if (!mockCallerOf(request).roles.includes('auditor')) {
    return problem(403, 'Forbidden');
  }
  const path = url.pathname;
  if (path === '/v1/audit/events') return listEvents(url.searchParams);
  const eventMatch = /^\/v1\/audit\/events\/([^/]+)$/.exec(path);
  if (eventMatch) {
    const found = events().find((event) => event.eventId === eventMatch[1]);
    if (!found) return problem(404, 'Not Found');
    const event: AuditEvent = {
      ...summary(found),
      request: found.request,
      traceparent: found.traceparent,
      data: found.data,
      chain: found.chain,
    };
    return json(200, event);
  }
  if (path === '/v1/audit/chains') {
    const tenant = url.searchParams.get('tenant');
    return json(200, { items: chains().filter((chain) => !tenant || chain.tenant === tenant) });
  }
  const verifyMatch = /^\/v1\/audit\/chains\/([^/]+)\/([^/]+)\/verification$/.exec(path);
  if (verifyMatch) {
    const [, tenant, chainDay] = verifyMatch;
    const chain = chains().find((each) => each.tenant === tenant && each.chainDay === chainDay);
    const verification: AuditChainVerification = {
      tenant: tenant ?? '',
      chainDay: chainDay ?? '',
      events: chain?.events ?? 0,
      status: 'intact',
      problems: [],
      anchor: chain?.anchor
        ? { status: 'matches', anchoredAt: chain.anchor.anchoredAt }
        : { status: 'none', anchoredAt: null },
      merkleRoot: chain
        ? (chain.anchor?.merkleRoot ?? sha(`root:${tenant ?? ''}|${chainDay ?? ''}`))
        : null,
    };
    return json(200, verification);
  }
  return problem(404, 'Not Found');
}

function listEvents(params: URLSearchParams): Response {
  const limit = Math.min(Number(params.get('limit') ?? 50) || 50, 200);
  const offset = params.get('cursor')
    ? Number(Buffer.from(params.get('cursor') ?? '', 'base64url').toString())
    : 0;
  if (!Number.isInteger(offset) || offset < 0) return problem(400, 'Validation failed');
  const action = params.get('action');
  const from = params.get('from');
  const to = params.get('to');
  const matches = events().filter(
    (event) =>
      (!params.get('tenant') || event.tenant === params.get('tenant')) &&
      (!params.get('actor') || event.actor.id === params.get('actor')) &&
      (!params.get('subjectPersonId') ||
        event.resource.subjectPersonId === params.get('subjectPersonId')) &&
      (!params.get('resourceType') || event.resource.type === params.get('resourceType')) &&
      (!params.get('resourceId') || event.resource.id === params.get('resourceId')) &&
      (!params.get('kind') || event.kind === params.get('kind')) &&
      (!action ||
        (action.endsWith('.') ? event.action.startsWith(action) : event.action === action)) &&
      (!from || event.occurredAt >= new Date(from).toISOString()) &&
      (!to || event.occurredAt < new Date(to).toISOString()),
  );
  const page = matches.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  return json(200, {
    items: page.map(summary),
    nextCursor:
      nextOffset < matches.length ? Buffer.from(String(nextOffset)).toString('base64url') : null,
  });
}

/** A client of the mock as a signed-in user with `roles` (tests). */
export function mockAuditClient(roles: readonly string[]) {
  const token = unsignedMockToken({
    subject: AUDITOR,
    name: 'Kariuki Muriithi',
    roles,
    tenant: 'eacc',
  });
  return createClient<paths>({
    baseUrl: 'http://audit.mock',
    headers: { authorization: `Bearer ${token}` },
    fetch: mockAuditFetch,
  });
}
