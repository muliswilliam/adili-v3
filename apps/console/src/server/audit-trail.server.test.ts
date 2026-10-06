import { beforeEach, describe, expect, it } from 'vitest';

import { mockAuditClient, mockAuditPersonsClient, resetAuditMock } from './audit/mock.server';
import {
  getAuditEvent,
  getAuditPersonName,
  listAuditChains,
  listAuditEvents,
  nairobiDayEnd,
  nairobiDayStart,
  verifyAuditChain,
} from './audit-trail.server';

const auditor = () => mockAuditClient(['auditor']);

beforeEach(() => {
  resetAuditMock();
});

describe('the audit trail reads', () => {
  it('lists events newest first for an auditor', async () => {
    const result = await listAuditEvents(auditor(), {}, 50);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const times = result.data.items.map((item) => item.occurredAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(result.data.items.length).toBeGreaterThan(5);
  });

  it('filters by kind and action prefix, a page at a time', async () => {
    const reads = await listAuditEvents(auditor(), { kind: 'read' }, 50);
    expect(reads.ok && reads.data.items.every((item) => item.kind === 'read')).toBe(true);
    const review = await listAuditEvents(auditor(), { action: 'review.' }, 1);
    expect(review.ok && review.data.items).toHaveLength(1);
    expect(review.ok && review.data.nextCursor).toBeTruthy();
  });

  it('refuses anyone but an auditor', async () => {
    const result = await listAuditEvents(mockAuditClient(['eacc-analyst']), {}, 10);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
  });

  it('reads an event with its data as JSON text', async () => {
    const page = await listAuditEvents(auditor(), {}, 1);
    const first = page.ok ? page.data.items[0] : undefined;
    expect(first).toBeDefined();
    const event = await getAuditEvent(auditor(), first?.eventId ?? '');
    expect(event.ok).toBe(true);
    if (!event.ok) return;
    expect(JSON.parse(event.data.dataJson)).toBeTypeOf('object');
    expect(event.data.chain.seq).toBeGreaterThanOrEqual(1);
  });

  it('names the person an event is about, for an auditor only', async () => {
    const page = await listAuditEvents(auditor(), { action: 'review.case.viewed' }, 1);
    const personId = page.ok ? page.data.items[0]?.resource.subjectPersonId : null;
    expect(personId).toBeTruthy();
    const name = await getAuditPersonName(mockAuditPersonsClient(['auditor']), personId ?? '');
    expect(name).toEqual({ ok: true, data: 'Wanjiku Kamau' });
    const refused = await getAuditPersonName(
      mockAuditPersonsClient(['eacc-analyst']),
      personId ?? '',
    );
    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
  });

  it('lists chains and verifies one', async () => {
    const chains = await listAuditChains(auditor(), { limit: 50 });
    expect(chains.ok).toBe(true);
    const chain = chains.ok ? chains.data.items[0] : undefined;
    const verification = await verifyAuditChain(
      auditor(),
      chain?.tenant ?? '',
      chain?.chainDay ?? '',
    );
    expect(verification).toMatchObject({ ok: true, data: { status: 'intact' } });
  });
});

describe('Nairobi days', () => {
  it('turn into the instants the service filters on', () => {
    expect(nairobiDayStart('2026-10-05')).toBe('2026-10-04T21:00:00.000Z');
    expect(nairobiDayEnd('2026-10-05')).toBe('2026-10-05T21:00:00.000Z');
  });
});
