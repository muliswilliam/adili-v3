import { randomUUID } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PauseFlags } from '../src/adapter-kit/pause-flags.js';
import { integrationSettings, outbox, verificationResults } from '../src/db/schema.js';
import { IntegrationSettings } from '../src/integrations/integration-settings.js';

import { SEED, StubRegistries } from './support/stub-registries.js';
import { createTestApp, type TestApp } from './support/test-app.js';

/**
 * S13 (pause): a platform administrator pauses a registry during a known outage, so lookups of
 * IDs not in the cache answer `unavailable` (reason `paused`) without calling it, then resumes
 * it; both recorded with who and when, and announced.
 */
describe('POST /v1/integrations/{system}/pause and /resume', () => {
  let registries: StubRegistries;
  let t: TestApp;
  let admin: Record<string, string>;
  let review: Record<string, string>;

  beforeAll(async () => {
    registries = await StubRegistries.start();
    t = await createTestApp({ registryUrls: registries.urls });
    t.app.useLogger(false);
    admin = {
      authorization: `Bearer ${await t.token({ clientId: 'console', roles: ['platform-admin'], tenant: 'platform' })}`,
    };
    review = {
      authorization: `Bearer ${await t.token({ clientId: 'review', scope: 'registry' })}`,
      'x-acting-tenant': 'psc',
      'x-legal-basis': 'regs-r20-1-b',
    };
    return async () => {
      await t.close();
      await registries.close();
    };
  });

  beforeEach(async () => {
    registries.reset();
    await t.clearCache();
    await t.db.delete(verificationResults);
    await t.db.delete(integrationSettings);
    await t.db.delete(outbox);
  });

  const act = (system: string, action: 'pause' | 'resume', headers = admin) =>
    t.app.inject({ method: 'POST', url: `/v1/integrations/${system}/${action}`, headers });

  const kraLookup = async (nationalId: string) =>
    (
      await t.app.inject({
        method: 'POST',
        url: '/internal/v1/kra/taxpayer-lookups',
        headers: review,
        payload: { nationalId },
      })
    ).json<{ outcome: string; reason: string | null; cached: boolean }>();

  const events = async () =>
    (await t.db.select().from(outbox).orderBy(asc(outbox.createdAt))).filter((event) =>
      event.eventType.startsWith('integrations.'),
    );

  it('pauses: lookups of uncached IDs are unavailable (paused) with no registry call; cached answers still serve', async () => {
    expect(await kraLookup(SEED.wanjiku)).toMatchObject({ outcome: 'found', cached: false });
    const callsBefore = registries.calls.kra;

    const response = await act('kra', 'pause');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      system: 'kra',
      paused: true,
      pausedBy: 'user-platform-admin',
      pausedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
    });
    expect(await kraLookup(SEED.kiprono)).toEqual(
      expect.objectContaining({ outcome: 'unavailable', reason: 'paused' }),
    );
    expect(await kraLookup(SEED.wanjiku)).toMatchObject({ outcome: 'found', cached: true });
    expect(registries.calls.kra).toBe(callsBefore);

    const [row] = await t.db
      .select()
      .from(integrationSettings)
      .where(eq(integrationSettings.system, 'kra'));
    expect(row).toMatchObject({ paused: true, pausedBy: 'user-platform-admin' });
    const [event] = await events();
    expect(event?.eventType).toBe('integrations.system.paused.v1');
    expect(event?.envelope).toMatchObject({
      subject: 'kra',
      tenant: 'platform',
      data: { system: 'kra', by: 'user-platform-admin' },
    });
  });

  it('pausing a paused system records nothing new; other systems keep running', async () => {
    const first = (await act('ntsa', 'pause')).json<{ pausedAt: string }>();
    const again = await act('ntsa', 'pause');

    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ paused: true, pausedAt: first.pausedAt });
    expect((await events()).map((event) => event.eventType)).toEqual([
      'integrations.system.paused.v1',
    ]);
    expect(await kraLookup(SEED.kiprono)).toMatchObject({ outcome: 'found' });
  });

  it('resumes: lookups call the registry again; the coverage no longer shows who paused it', async () => {
    await act('kra', 'pause');
    expect(await kraLookup(SEED.kiprono)).toMatchObject({ reason: 'paused' });

    const response = await act('kra', 'resume');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      system: 'kra',
      paused: false,
      pausedBy: null,
      pausedAt: null,
    });
    expect(await kraLookup(SEED.kiprono)).toMatchObject({ outcome: 'found', cached: false });
    expect(registries.calls.kra).toBeGreaterThan(0);
    expect((await events()).map((event) => [event.eventType, event.envelope.data])).toEqual([
      ['integrations.system.paused.v1', { system: 'kra', by: 'user-platform-admin' }],
      ['integrations.system.resumed.v1', { system: 'kra', by: 'user-platform-admin' }],
    ]);

    // Resuming a running system changes nothing.
    expect((await act('kra', 'resume')).statusCode).toBe(200);
    expect(await events()).toHaveLength(2);
  });

  it('accepts an Idempotency-Key: a retry with it replays the answer (ADR-013 §7.5)', async () => {
    const headers = { ...admin, 'idempotency-key': randomUUID() };

    const first = await act('kra', 'pause', headers);
    await act('kra', 'resume');
    const retry = await act('kra', 'pause', headers);

    expect(retry.statusCode).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json()).toEqual(first.json());
    // The replay paused nothing again: the resume stands.
    expect(await t.app.get(PauseFlags).isPaused('kra')).toBe(false);
  });

  it('shows who paused a system and since when in the coverage', async () => {
    await act('ardhisasa', 'pause');

    const rows = (
      await t.app.inject({ method: 'GET', url: '/v1/integrations/coverage', headers: admin })
    ).json<{ system: string; paused: boolean; pausedBy: string | null }[]>();

    expect(rows.find((row) => row.system === 'ardhisasa')).toMatchObject({
      paused: true,
      pausedBy: 'user-platform-admin',
    });
    expect(rows.find((row) => row.system === 'brs')).toMatchObject({
      paused: false,
      pausedBy: null,
    });
  });

  it('restores the pause flags of paused systems on start', async () => {
    await act('brs', 'pause');
    const pauses = t.app.get(PauseFlags);
    // Valkey lost the flag (a restart without persistence, say).
    await pauses.resume('brs');

    await t.app.get(IntegrationSettings).onApplicationBootstrap();

    expect(await pauses.isPaused('brs')).toBe(true);
  });

  it('clears on start a pause flag no paused record backs', async () => {
    const pauses = t.app.get(PauseFlags);
    // A flag left behind: written for a pause whose record never committed, say.
    await pauses.pause('ntsa');

    await t.app.get(IntegrationSettings).onApplicationBootstrap();

    expect(await pauses.isPaused('ntsa')).toBe(false);
  });

  it('writes the pause flag only once the pause is committed', async () => {
    const pauses = t.app.get(PauseFlags);
    const committedWhenFlagged: boolean[] = [];
    const spy = vi.spyOn(pauses, 'pause').mockImplementation(async function (this: PauseFlags) {
      // Read outside the request's transaction: only committed rows are visible.
      const [row] = await t.db
        .select()
        .from(integrationSettings)
        .where(eq(integrationSettings.system, 'kra'));
      committedWhenFlagged.push(row?.paused === true);
    });
    try {
      expect((await act('kra', 'pause')).statusCode).toBe(200);
    } finally {
      spy.mockRestore();
    }

    expect(committedWhenFlagged).toEqual([true]);
  });

  it('keeps the record and answers 503 when the flag cannot be written; a retry applies it', async () => {
    const pauses = t.app.get(PauseFlags);
    const spy = vi.spyOn(pauses, 'pause').mockRejectedValueOnce(new Error('valkey down'));
    try {
      const failed = await act('kra', 'pause');

      expect(failed.statusCode).toBe(503);
      expect(failed.json()).toMatchObject({ type: 'pause-flag-unavailable' });
    } finally {
      spy.mockRestore();
    }
    const [row] = await t.db
      .select()
      .from(integrationSettings)
      .where(eq(integrationSettings.system, 'kra'));
    expect(row?.paused).toBe(true);
    expect(await pauses.isPaused('kra')).toBe(false);

    expect((await act('kra', 'pause')).statusCode).toBe(200);
    expect(await pauses.isPaused('kra')).toBe(true);
    expect(await events()).toHaveLength(1);
  });

  it('refuses reviewers and service tokens with 403, nobody with 401; nothing is paused', async () => {
    const reviewer = {
      authorization: `Bearer ${await t.token({ clientId: 'console', roles: ['reviewer'], tenant: 'psc' })}`,
    };
    for (const action of ['pause', 'resume'] as const) {
      expect((await act('kra', action, reviewer)).statusCode).toBe(403);
      expect(
        (await act('kra', action, { authorization: review.authorization ?? '' })).statusCode,
      ).toBe(403);
      expect((await act('kra', action, {})).statusCode).toBe(401);
    }
    expect(await t.app.get(PauseFlags).isPaused('kra')).toBe(false);
    expect(await events()).toEqual([]);
  });

  it('a system without an adapter is 404; an unknown one 400', async () => {
    expect((await act('payroll', 'pause')).statusCode).toBe(404);
    expect((await act('mpesa', 'pause')).statusCode).toBe(400);
    expect(await events()).toEqual([]);
  });
});
