import { describe, expect, it, vi } from 'vitest';

import {
  consoleIsUp,
  GOING_DOWN_MS,
  POLL_MS,
  type RestartPhase,
  timeLeft,
  waitForRestart,
} from './demo-restart';

const up = () => Response.json({ status: 'up', mocks: [] });
const badGateway = () => new Response('Bad Gateway', { status: 502 });
const caddyPage = () =>
  new Response('<!doctype html><title>Restarting</title>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });

/** A clock that only moves when the code under test sleeps. */
function fakeTime() {
  let now = 0;
  return {
    now: () => now,
    sleep: vi.fn((ms: number) => {
      now += ms;
      return Promise.resolve();
    }),
  };
}

describe('consoleIsUp (#622)', () => {
  it('counts only a health check that says up', async () => {
    const now = () => 1;
    expect(await consoleIsUp({ fetch: () => Promise.resolve(up()), now })).toBe(true);
    // Caddy's 502 while the console is down was taken for the console answering.
    expect(await consoleIsUp({ fetch: () => Promise.resolve(badGateway()), now })).toBe(false);
    expect(await consoleIsUp({ fetch: () => Promise.resolve(caddyPage()), now })).toBe(false);
    expect(await consoleIsUp({ fetch: () => Promise.reject(new TypeError('down')), now })).toBe(
      false,
    );
  });

  it('asks past any cache', async () => {
    const fetch = vi.fn(() => Promise.resolve(up()));
    await consoleIsUp({ fetch, now: () => 42 });
    expect(fetch).toHaveBeenCalledWith(
      '/health?t=42',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});

describe('waitForRestart (#622)', () => {
  it('waits for the console to go down and come back, through 502s and failed requests', async () => {
    const time = fakeTime();
    const failed = () => Promise.reject(new TypeError('Failed to fetch'));
    const answers: (() => Promise<Response>)[] = [
      () => Promise.resolve(up()),
      () => Promise.resolve(up()),
      () => Promise.resolve(badGateway()),
      failed,
      () => Promise.resolve(caddyPage()),
      () => Promise.resolve(badGateway()),
      () => Promise.resolve(up()),
    ];
    const fetch = vi.fn(() => {
      const next = answers.shift();
      if (!next) throw new Error('asked too often');
      return next();
    });
    const phases: RestartPhase[] = [];

    await waitForRestart({ fetch, ...time, onPhase: (phase) => phases.push(phase) });

    expect(fetch).toHaveBeenCalledTimes(7);
    expect(phases).toEqual(['stopping', 'restoring', 'back']);
    expect(time.sleep).toHaveBeenCalledWith(POLL_MS);
  });

  it('stops waiting for the outage when the console went down and up between two polls', async () => {
    const time = fakeTime();
    const fetch = vi.fn(() => Promise.resolve(up()));

    await waitForRestart({ fetch, ...time });

    expect(time.now()).toBeGreaterThanOrEqual(GOING_DOWN_MS);
    expect(time.now()).toBeLessThan(GOING_DOWN_MS + 2 * POLL_MS);
  });
});

describe('timeLeft', () => {
  it('counts down in minutes, then seconds, then says it is late', () => {
    expect(timeLeft(0)).toBe('About 4 minutes left');
    expect(timeLeft(3 * 60_000 + 1)).toBe('About 60 seconds left');
    expect(timeLeft(3 * 60_000 + 30_000)).toBe('About 30 seconds left');
    expect(timeLeft(3 * 60_000 + 58_000)).toBe('About 10 seconds left');
    expect(timeLeft(5 * 60_000)).toBe(
      'Taking a little longer than usual. Still waiting for the apps.',
    );
  });
});
