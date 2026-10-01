// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  IntegrationGatewayResult,
  SystemCoverage,
} from '../../server/integration-gateway/client';
import { IntegrationsView, type IntegrationsViewProps } from './integrations-view';

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }));

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

const HEALTHY: SystemCoverage[] = [
  coverage({
    system: 'iprs',
    calls24h: 18_422,
    cacheHitRate: 0.71,
    lastSuccessAt: '2026-09-26T07:29:00Z',
  }),
  coverage({
    system: 'kra',
    calls24h: 41_230,
    cacheHitRate: 0.38,
    lastSuccessAt: '2026-09-26T07:27:00Z',
  }),
  coverage({
    system: 'ntsa',
    calls24h: 29_870,
    cacheHitRate: 0.41,
    lastSuccessAt: '2026-09-26T07:20:00Z',
  }),
  coverage({
    system: 'brs',
    calls24h: 40_115,
    cacheHitRate: 0.44,
    lastSuccessAt: '2026-09-26T07:30:00Z',
  }),
  coverage({
    system: 'ardhisasa',
    calls24h: 12_004,
    cacheHitRate: 0.52,
    lastSuccessAt: '2026-09-26T06:41:00Z',
  }),
];

const ok = (rows: SystemCoverage[]): IntegrationGatewayResult<SystemCoverage[]> => ({
  ok: true,
  data: rows,
});

function renderView(overrides: Partial<IntegrationsViewProps> = {}) {
  const onRefresh = vi.fn();
  render(
    <IntegrationsView
      result={ok(HEALTHY)}
      loadedAt="2026-09-26T07:30:00Z"
      onRefresh={onRefresh}
      now={NOW}
      {...overrides}
    />,
  );
  return { onRefresh };
}

const list = () => screen.getByRole('list', { name: 'Integration coverage' });
const row = (system: string) => {
  const item = list().querySelector<HTMLElement>(`[data-system="${system}"]`);
  if (!item) throw new Error(`No row for ${system}`);
  return item;
};

describe('S15 Integrations page', () => {
  it('lists each system with calls, cache hit rate, last success and breaker', () => {
    renderView();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Integrations');
    expect(
      within(list())
        .getAllByRole('listitem')
        .map((item) => item.dataset.system),
    ).toEqual(['iprs', 'kra', 'ntsa', 'brs', 'ardhisasa']);
    const kra = within(row('kra'));
    kra.getByRole('button', { name: 'KRA iTax' });
    kra.getByText('PIN, tax compliance and income declared to KRA');
    kra.getByText('41,230');
    kra.getByText('38%');
    kra.getByText('3 minutes ago');
    kra.getByText('Closed');
    expect(within(row('ardhisasa')).getByText('49 minutes ago')).toBeTruthy();
  });

  it('sums the tiles and says all is well when every breaker is closed', () => {
    renderView();

    const tiles = within(screen.getByRole('group', { name: 'Summary' }));
    tiles.getByText('141,641');
    // Weighted by calls: (18422*.71 + 41230*.38 + 29870*.41 + 40115*.44 + 12004*.52) / 141641.
    tiles.getByText('46%');
    tiles.getByText('0 half-open');
    expect(screen.getByRole('status').textContent).toBe('All systems are working normally.');
    screen.getByText('Updated 10:30');
  });

  it('raises open, recovering and paused systems, and shows paused rows', () => {
    renderView({
      result: ok([
        coverage({ system: 'kra', breaker: 'half-open', lastSuccessAt: '2026-09-26T07:27:00Z' }),
        coverage({ system: 'ntsa', breaker: 'open', paused: true }),
        coverage({
          system: 'ardhisasa',
          breaker: 'open',
          failures24h: 2_981,
          lastSuccessAt: '2026-09-26T04:41:00Z',
        }),
      ]),
    });

    expect(screen.getByRole('alert').textContent).toBe(
      'ArdhiSasa is not responding. Breaker open. Last success 2 hours ago.',
    );
    screen.getByText('KRA iTax is recovering.');
    screen.getByText('NTSA TIMS is paused.');
    within(row('ntsa')).getByText('Paused');
    within(row('ntsa')).getByText('Open');
    within(row('kra')).getByText('Half-open');
    // A failing registry silent for hours stands out.
    expect(within(row('ardhisasa')).getByText('2 hours ago').closest('.text-destructive')).not.toBe(
      null,
    );
    const tiles = within(screen.getByRole('group', { name: 'Summary' }));
    tiles.getByText('1 half-open');
    tiles.getByText('NTSA TIMS');
  });

  it('expands a system to its configuration and breaker rule', () => {
    renderView({
      result: ok([
        coverage({
          system: 'ardhisasa',
          breaker: 'open',
          failures24h: 2_981,
          rateLimitPerMinute: 300,
        }),
      ]),
    });

    const toggle = screen.getByRole('button', { name: 'ArdhiSasa' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const details = within(row('ardhisasa'));
    details.getByText('Ministry of Lands and Physical Planning');
    details.getByText('300 calls a minute');
    details.getByText('24 hours, hits and misses');
    details.getByText('2,981');
    details.getByText('Opens after 5 failures in a row, tries again after 30 seconds');
    details.getByText('2 seconds per call');
    details.getByText(/Opened after repeated failures\. Calls are not being sent/);
  });

  it('shows never for a system that has not answered yet', () => {
    renderView({ result: ok([coverage({ system: 'brs' })]) });

    within(row('brs')).getByText('Never');
    within(screen.getByRole('group', { name: 'Summary' })).getByText('0%');
  });

  it('refreshes on demand', () => {
    const { onRefresh } = renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('shows a skeleton while loading, with refresh disabled', () => {
    renderView({ result: null, loadedAt: null });

    screen.getByLabelText('Integration coverage (loading)');
    expect(screen.getByRole('button', { name: 'Refresh' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText(/Updated/)).toBe(null);
  });

  it('says coverage could not be loaded when the gateway does not answer', () => {
    renderView({ result: { ok: false, error: { kind: 'unavailable', detail: null } } });

    screen.getByText('Coverage could not be loaded.');
    expect(screen.queryByText(/Updated/)).toBe(null);
    screen.getByText('Registries may still be working. Try again in a moment.');
    screen.getByRole('button', { name: 'Try again' });
  });

  it('refuses anyone but platform administrators', () => {
    renderView({
      result: {
        ok: false,
        error: {
          kind: 'problem',
          problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
        },
      },
      forbiddenAction: <a href="/">Back to overview</a>,
    });

    screen.getByText('You do not have access to integrations.');
    screen.getByRole('link', { name: 'Back to overview' });
    expect(screen.queryByRole('list')).toBe(null);
  });

  it('says so when no system has an adapter', () => {
    renderView({ result: ok([]) });

    screen.getByText('No integrations yet');
  });
});
