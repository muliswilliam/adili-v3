import { describe, expect, it } from 'vitest';

import type { SystemCoverage } from '../../server/integration-gateway/client';
import {
  formatDuration,
  formatLastSuccess,
  formatPercent,
  isInstructed,
  isLastSuccessStale,
  summarise,
  systemInfo,
} from './coverage';

const NOW = new Date('2026-09-26T07:30:00Z');

function coverage(overrides: Partial<SystemCoverage> = {}): SystemCoverage {
  return {
    system: 'kra',
    calls24h: 0,
    cacheHitRate: 0,
    failures24h: 0,
    breaker: 'closed',
    lastSuccessAt: null,
    paused: false,
    pausedBy: null,
    pausedAt: null,
    rateLimitPerMinute: 600,
    cacheTtlSeconds: 86_400,
    timeoutMs: 2_000,
    breakerFailureThreshold: 5,
    breakerCooldownSeconds: 30,
    ...overrides,
  };
}

describe('summarise', () => {
  it('adds calls and weighs the hit rate by them', () => {
    const summary = summarise([
      coverage({ system: 'kra', calls24h: 300, cacheHitRate: 0.5 }),
      coverage({ system: 'ntsa', calls24h: 100, cacheHitRate: 0.1 }),
      coverage({ system: 'brs' }),
    ]);

    expect(summary.calls24h).toBe(400);
    expect(summary.cacheHitRate).toBeCloseTo(0.4);
  });

  it('leaves systems that never cache out of the hit rate, not out of the calls', () => {
    const summary = summarise([
      coverage({ system: 'kra', calls24h: 300, cacheHitRate: 0.5 }),
      coverage({ system: 'payroll', calls24h: 100, cacheHitRate: 0, cacheTtlSeconds: null }),
    ]);

    expect(summary.calls24h).toBe(400);
    expect(summary.cachedCalls24h).toBe(300);
    expect(summary.cacheHitRate).toBeCloseTo(0.5);
  });

  it('has a hit rate of 0 without calls', () => {
    expect(summarise([coverage(), coverage({ system: 'ntsa' })]).cacheHitRate).toBe(0);
  });

  it('counts open breakers of running systems, half-open ones and paused systems apart', () => {
    const summary = summarise([
      coverage({ system: 'kra', breaker: 'half-open' }),
      coverage({ system: 'ntsa', breaker: 'open', paused: true }),
      coverage({ system: 'ardhisasa', breaker: 'open' }),
      coverage({ system: 'brs' }),
    ]);

    expect(summary.open.map((row) => row.system)).toEqual(['ardhisasa']);
    expect(summary.halfOpen.map((row) => row.system)).toEqual(['kra']);
    expect(summary.paused.map((row) => row.system)).toEqual(['ntsa']);
  });
});

describe('formatting', () => {
  it('prints rates as whole percentages', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.384)).toBe('38%');
    expect(formatPercent(1)).toBe('100%');
  });

  it('says when the registry last answered', () => {
    expect(formatLastSuccess(null, NOW, 'Never')).toBe('Never');
    expect(formatLastSuccess('2026-09-26T07:29:50Z', NOW, 'Never')).toBe('Just now');
    expect(formatLastSuccess('2026-09-26T07:27:00Z', NOW, 'Never')).toBe('3 minutes ago');
    expect(formatLastSuccess('2026-09-26T02:58:00Z', NOW, 'Never')).toBe('4 hours ago');
    expect(formatLastSuccess('2026-09-24T07:30:00Z', NOW, 'Never')).toBe('2 days ago');
  });

  it('words durations in their largest whole unit', () => {
    expect(formatDuration(86_400)).toBe('24 hours');
    expect(formatDuration(3_600)).toBe('1 hour');
    expect(formatDuration(1_800)).toBe('30 minutes');
    expect(formatDuration(30)).toBe('30 seconds');
    expect(formatDuration(2)).toBe('2 seconds');
    expect(formatDuration(1.5)).toBe('1.5 seconds');
  });
});

describe('isLastSuccessStale', () => {
  it('flags a failing registry that has not answered for over an hour, or ever', () => {
    expect(
      isLastSuccessStale(coverage({ failures24h: 3, lastSuccessAt: '2026-09-26T05:58:00Z' }), NOW),
    ).toBe(true);
    expect(isLastSuccessStale(coverage({ failures24h: 3 }), NOW)).toBe(true);
  });

  it('leaves quiet, recently answering or paused systems alone', () => {
    expect(isLastSuccessStale(coverage({ lastSuccessAt: '2026-09-20T05:58:00Z' }), NOW)).toBe(
      false,
    );
    expect(
      isLastSuccessStale(coverage({ failures24h: 3, lastSuccessAt: '2026-09-26T07:00:00Z' }), NOW),
    ).toBe(false);
    expect(isLastSuccessStale(coverage({ failures24h: 3, paused: true }), NOW)).toBe(false);
  });
});

describe('systemInfo', () => {
  it('describes every system coverage lists', () => {
    expect(systemInfo('kra')).toEqual({
      name: 'KRA iTax',
      owner: 'Kenya Revenue Authority',
      use: 'PIN, tax compliance and income declared to KRA',
    });
    expect(systemInfo('hr-suppliers').name).toBe('HR supplier lists');
    expect(systemInfo('payroll')).toEqual({
      name: 'Payroll (IPPD)',
      owner: 'State Department for Public Service',
      use: 'Salary stoppages and reinstatements of officers',
      instructions: 'Salary stoppages and reinstatements',
    });
    expect(systemInfo('icms')).toEqual({
      name: 'EACC ICMS',
      owner: 'Ethics and Anti-Corruption Commission',
      use: "Commissions' referrals, registered as EACC cases",
      instructions: 'Referrals',
    });
  });

  it('tells the systems Adili instructs from the ones it looks up', () => {
    expect(isInstructed(systemInfo('payroll'))).toBe(true);
    expect(isInstructed(systemInfo('icms'))).toBe(true);
    expect(isInstructed(systemInfo('kra'))).toBe(false);
  });
});
