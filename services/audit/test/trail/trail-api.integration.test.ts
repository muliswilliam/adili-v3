import { randomUUID } from 'node:crypto';

import { AUDIT_READ } from '@adili/events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chainDayOf } from '../../src/trail/chain.js';
import { AUDITOR_CALLER, type AuditApi, startAuditApi } from '../support/audit-api.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { caseRead, freshTenant, submitted } from '../support/events.js';

let api: AuditApi;
const today = chainDayOf(new Date());

beforeAll(async () => {
  api = await startAuditApi();
});

afterAll(async () => {
  await api.close();
});

describe('who may read the trail', () => {
  it.each([
    ['eacc-analyst', 'eacc'],
    ['platform-admin', 'platform'],
    ['reviewer', 'psc'],
    ['helpdesk', 'platform'],
  ])('refuses a %s', async (role, tenant) => {
    const response = await api.get('/v1/audit/events', { tenant, roles: [role] });
    expect(response.statusCode).toBe(403);
  });

  it('refuses a caller without a token', async () => {
    const response = await api.app.inject({ method: 'GET', url: '/v1/audit/events' });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /v1/audit/events', () => {
  it('lists events newest first, filtered, a page at a time', async () => {
    const tenant = freshTenant();
    const person = randomUUID();
    const reads = [caseRead(tenant, person), caseRead(tenant, person), caseRead(tenant, person)];
    for (const event of [submitted(tenant), ...reads, caseRead(tenant)]) await api.deliver(event);

    const first = await api.get(
      `/v1/audit/events?tenant=${tenant}&subjectPersonId=${person}&kind=read&limit=2`,
      AUDITOR_CALLER,
    );
    expect(first.statusCode).toBe(200);
    expect(contractErrors(okResponse('/v1/audit/events', 'get'), first.json())).toEqual([]);
    const page1 = first.json<{ items: { eventId: string }[]; nextCursor: string | null }>();
    expect(page1.items.map((item) => item.eventId)).toEqual([reads[2]?.id, reads[1]?.id]);
    expect(page1.nextCursor).not.toBeNull();

    const second = await api.get(
      `/v1/audit/events?tenant=${tenant}&subjectPersonId=${person}&kind=read&limit=2&cursor=${String(page1.nextCursor)}`,
      AUDITOR_CALLER,
    );
    const page2 = second.json<{ items: { eventId: string }[]; nextCursor: string | null }>();
    expect(page2.items.map((item) => item.eventId)).toEqual([reads[0]?.id]);
    expect(page2.nextCursor).toBeNull();
  });

  it('filters by action prefix and actor', async () => {
    const tenant = freshTenant();
    await api.deliver(submitted(tenant));
    await api.deliver(caseRead(tenant, randomUUID(), 'someone'));
    const byAction = await api.get(
      `/v1/audit/events?tenant=${tenant}&action=declaration.`,
      AUDITOR_CALLER,
    );
    expect(byAction.json<{ items: { action: string }[] }>().items.map((i) => i.action)).toEqual([
      'declaration.submitted',
    ]);
    const byActor = await api.get(
      `/v1/audit/events?tenant=${tenant}&actor=someone`,
      AUDITOR_CALLER,
    );
    expect(byActor.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it('refuses a cursor it did not issue', async () => {
    const response = await api.get('/v1/audit/events?cursor=bogus', AUDITOR_CALLER);
    expect(response.statusCode).toBe(400);
  });

  it('audits the search itself', async () => {
    await api.get('/v1/audit/events?limit=1', AUDITOR_CALLER);
    const reads = (await api.outbox()).filter((event) => event.type === AUDIT_READ);
    expect(reads.at(-1)?.data).toMatchObject({
      action: 'audit.events.searched',
      actor: { subject: AUDITOR_CALLER.sub, roles: ['auditor'] },
    });
  });
});

describe('GET /v1/audit/events/:eventId', () => {
  it('shows an event with its data and place in its chain', async () => {
    const tenant = freshTenant();
    const event = submitted(tenant);
    await api.deliver(event);
    const response = await api.get(`/v1/audit/events/${event.id}`, AUDITOR_CALLER);
    expect(response.statusCode).toBe(200);
    expect(
      contractErrors(okResponse('/v1/audit/events/{eventId}', 'get'), response.json()),
    ).toEqual([]);
    expect(response.json()).toMatchObject({
      eventId: event.id,
      action: 'declaration.submitted',
      data: event.data,
      chain: { chainDay: today, seq: 1 },
    });
  });

  it('answers 404 for an unknown event', async () => {
    const response = await api.get(`/v1/audit/events/${randomUUID()}`, AUDITOR_CALLER);
    expect(response.statusCode).toBe(404);
  });
});

describe('chains', () => {
  it('lists the chains and verifies one', async () => {
    const tenant = freshTenant();
    await api.deliver(submitted(tenant));
    await api.deliver(submitted(tenant));
    const list = await api.get(`/v1/audit/chains?tenant=${tenant}`, AUDITOR_CALLER);
    expect(contractErrors(okResponse('/v1/audit/chains', 'get'), list.json())).toEqual([]);
    expect(list.json()).toMatchObject({
      items: [{ tenant, chainDay: today, events: 2, anchor: null }],
    });
    const verification = await api.get(
      `/v1/audit/chains/${tenant}/${today}/verification`,
      AUDITOR_CALLER,
    );
    expect(verification.statusCode).toBe(200);
    expect(verification.json()).toMatchObject({ status: 'intact', events: 2 });
  });

  it("checks an anchored chain's signature", async () => {
    const tenant = freshTenant();
    const yesterdayAt = new Date(Date.now() - 86_400_000);
    const yesterday = chainDayOf(yesterdayAt);
    await api.trail.append(submitted(tenant), yesterdayAt);
    await api.anchoring.anchor({ tenant, chainDay: yesterday });
    const path = `/v1/audit/chains/${tenant}/${yesterday}/verification`;
    expect((await api.get(path, AUDITOR_CALLER)).json()).toMatchObject({
      status: 'intact',
      anchor: { status: 'matches' },
    });

    await api.tamper(`update audit_anchors set signature = 'forged' where tenant = '${tenant}'`);
    expect((await api.get(path, AUDITOR_CALLER)).json()).toMatchObject({
      status: 'tampered',
      problems: [{ kind: 'anchor-mismatch', seq: null }],
      anchor: { status: 'mismatch' },
    });
  });
});
