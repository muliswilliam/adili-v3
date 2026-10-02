import { describe, expect, it } from 'vitest';

import { IDS, NOW, seededRequest } from '../components/access/testing';
import { countdownSpoken, countdownText, packageView } from './package';

const HOUR = 3_600_000;

describe('packageView (#261)', () => {
  it('is ready with days left until the window ends', async () => {
    const view = packageView(await seededRequest(IDS.granted), NOW);
    if (view?.state !== 'ready') throw new Error(view?.state);
    expect(view.daysLeft).toBe(13);
    expect(view.lastDownloadAt).toBeNull();
    expect(view.msLeft).toBeGreaterThan(12 * 24 * HOUR);
  });

  it('counts from the latest registered download', async () => {
    const request = await seededRequest(IDS.expiring);
    const view = packageView(request, NOW);
    if (view?.state !== 'ready') throw new Error(view?.state);
    expect(view.daysLeft).toBe(0);
    expect(view.msLeft).toBe(5 * HOUR + 12 * 60_000);
    expect(view.lastDownloadAt).toBe(
      request.timeline.filter((entry) => entry.kind === 'downloaded').at(-1)?.at,
    );
  });

  it('expires at the end of the window, to the millisecond', async () => {
    const request = await seededRequest(IDS.expiring);
    const end = Date.parse(request.package?.downloadExpiresAt ?? '');
    expect(packageView(request, end - 1)?.state).toBe('ready');
    expect(packageView(request, end)?.state).toBe('expired');
    expect(packageView(await seededRequest(IDS.expired), NOW)?.state).toBe('expired');
  });

  it('takes documents’ word (410) that the window closed, as of now', async () => {
    const view = packageView(await seededRequest(IDS.granted), NOW, true);
    if (view?.state !== 'expired') throw new Error(view?.state);
    expect(view.package.downloadExpiresAt).toBe(new Date(NOW).toISOString());
  });

  it('is being prepared for a grant without a package yet', async () => {
    expect(packageView(await seededRequest(IDS.preparing), NOW)).toEqual({ state: 'preparing' });
  });

  it('stays preparing however long it takes, until the service issues it or says it failed', async () => {
    const request = await seededRequest(IDS.preparing);
    const decided = Date.parse(request.decision?.decidedAt ?? '');
    expect(packageView(request, decided + 30 * 24 * HOUR)).toEqual({ state: 'preparing' });
    expect(packageView(await seededRequest(IDS.failed), NOW)).toEqual({ state: 'failed' });
  });

  it('reads a nil letter like a package: ready within its window, then expired', async () => {
    const ready = packageView(await seededRequest(IDS.nil), NOW);
    if (ready?.state !== 'ready') throw new Error(ready?.state);
    expect(ready.package.kind).toBe('nil-letter');
    expect(ready.daysLeft).toBe(11);
    const expired = packageView(await seededRequest(IDS.nilExpired), NOW);
    expect(expired).toMatchObject({ state: 'expired', package: { kind: 'nil-letter' } });
  });

  it('is absent for any status but a grant', async () => {
    for (const key of ['denied', 'deciding', 'withdrawn', 'cannot'] as const) {
      expect(packageView(await seededRequest(IDS[key]), NOW)).toBeNull();
    }
  });
});

describe('the countdown', () => {
  it('reads hours and minutes, at least a minute', () => {
    expect(countdownText(5 * HOUR + 12 * 60_000)).toBe('5 h 12 min');
    expect(countdownText(5 * HOUR + 11 * 60_000 + 1)).toBe('5 h 12 min');
    expect(countdownText(2 * HOUR)).toBe('2 h');
    expect(countdownText(59 * 60_000)).toBe('59 min');
    expect(countdownText(1)).toBe('1 min');
  });

  it('speaks at coarse steps: hours, then ten minutes, then the last minutes', () => {
    expect(countdownSpoken(5 * HOUR + 12 * 60_000)).toBe('Expires in 6 hours');
    expect(countdownSpoken(5 * HOUR + 1)).toBe('Expires in 6 hours');
    expect(countdownSpoken(5 * HOUR)).toBe('Expires in 5 hours');
    expect(countdownSpoken(HOUR + 60_000)).toBe('Expires in 2 hours');
    expect(countdownSpoken(HOUR)).toBe('Expires in 1 hour');
    expect(countdownSpoken(51 * 60_000)).toBe('Expires in 1 hour');
    expect(countdownSpoken(50 * 60_000)).toBe('Expires in 50 minutes');
    expect(countdownSpoken(42 * 60_000)).toBe('Expires in 50 minutes');
    expect(countdownSpoken(7 * 60_000)).toBe('Expires in 7 minutes');
    expect(countdownSpoken(1)).toBe('Expires in 1 minute');
  });
});
