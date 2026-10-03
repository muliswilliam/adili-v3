// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  IntegrationGatewayResult,
  IntegrationSystem,
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
  const view = (
    <IntegrationsView
      result={ok(HEALTHY)}
      loadedAt="2026-09-26T07:30:00Z"
      onRefresh={onRefresh}
      now={NOW}
      {...overrides}
    />
  );
  // The toasts of pause and resume; their live regions would also match the page's alerts.
  render(overrides.setPaused ? <ToastProvider>{view}</ToastProvider> : view);
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
    // Paused takes the breaker's place in the row; its state is in the details.
    within(row('ntsa')).getByText('Paused');
    expect(row('ntsa').querySelector('[data-state]')).toBeNull();
    expect(row('kra').querySelector('[data-state]')?.textContent).toBe('Half-open');
    fireEvent.click(screen.getByRole('button', { name: 'NTSA TIMS' }));
    expect(within(row('ntsa')).getByText('Breaker').nextElementSibling?.textContent).toBe('Open');
    within(row('kra')).getByText('Half-open');
    // A failing registry silent for hours stands out.
    expect(within(row('ardhisasa')).getByText('2 hours ago').closest('.text-destructive')).not.toBe(
      null,
    );
    const tiles = within(screen.getByRole('group', { name: 'Summary' }));
    tiles.getByText('1 half-open');
    tiles.getByText('NTSA TIMS');
  });

  it('says HR supplier lists are paused, not is', () => {
    renderView({
      result: ok([
        coverage({
          system: 'hr-suppliers',
          paused: true,
          pausedBy: 'Juma Omondi',
          pausedAt: '2026-09-26T07:18:00Z',
        }),
      ]),
    });

    expect(screen.getByRole('status').textContent).toMatch(
      /^HR supplier lists are paused\. Paused by Juma Omondi since \d\d:\d\d\. Lookups are marked unavailable until they are resumed\. Cached answers still serve\.$/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'HR supplier lists' }));
    within(row('hr-suppliers')).getByText(/Nothing is sent until they are resumed\.$/);
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

  it("lines each detail up under the row's column above it", () => {
    renderView({ result: ok([coverage({ system: 'kra', paused: true })]) });
    fireEvent.click(screen.getByRole('button', { name: 'KRA iTax' }));

    const columns = [...row('kra').querySelectorAll<HTMLElement>('dl [data-column]')].map(
      (item) => [item.querySelector('dt')?.textContent, item.dataset.column],
    );
    expect(columns).toEqual([
      ['Operated by', 'name'],
      ['Rate limit', 'calls'],
      ['Cache lifetime', 'last'],
      ['Failed calls (24 h)', 'name'],
      ['Timeout', 'calls'],
      ['Breaker rule', 'last'],
      ['Breaker', 'name'],
    ]);
  });

  it('shows never for a system that has not answered yet', () => {
    renderView({ result: ok([coverage({ system: 'brs' })]) });

    within(row('brs')).getByText('Never');
    // No calls, no rate: not 0%, which would read as a cache that never hits.
    within(row('brs')).getByText('No calls');
    const tiles = within(screen.getByRole('group', { name: 'Summary' }));
    tiles.getByText('No calls');
    tiles.getByText('No lookups in the last 24 hours');
    expect(screen.queryByText('0%')).toBeNull();
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

  describe('S13 pause and resume', () => {
    const PAUSED_NTSA = coverage({
      system: 'ntsa',
      paused: true,
      pausedBy: 'Amina Wanjiru',
      pausedAt: '2026-09-26T06:00:00Z',
      rateLimitPerMinute: 40,
    });

    function renderActions(
      rows: SystemCoverage[],
      answer: Awaited<ReturnType<NonNullable<IntegrationsViewProps['setPaused']>>> = {
        ok: true,
        data: coverage(),
      },
    ) {
      const setPaused = vi.fn<NonNullable<IntegrationsViewProps['setPaused']>>(() =>
        Promise.resolve(answer),
      );
      const onChanged = vi.fn();
      renderView({ result: ok(rows), setPaused, onChanged });
      return { setPaused, onChanged };
    }

    it('offers Pause on a running system and Resume on a paused one; none without the action', () => {
      renderActions([coverage({ system: 'kra' }), PAUSED_NTSA]);

      within(row('kra')).getByRole('button', { name: 'Pause KRA iTax' });
      within(row('ntsa')).getByRole('button', { name: 'Resume NTSA TIMS' });
    });

    it('words the pause dialog of HR supplier lists in the plural', () => {
      renderActions([coverage({ system: 'hr-suppliers' })]);

      fireEvent.click(
        within(row('hr-suppliers')).getByRole('button', { name: 'Pause HR supplier lists' }),
      );
      const dialog = within(screen.getByRole('dialog'));
      dialog.getByText(
        'Lookups to HR supplier lists will be marked unavailable until they are resumed.',
      );
      dialog.getByText('Nothing is sent to HR supplier lists while they are paused.');
      dialog.getByText('Affected cases are re-checked every hour until they answer.');
    });

    it('has no actions when the page cannot pause', () => {
      renderView({ result: ok([coverage({ system: 'kra' })]) });

      expect(within(row('kra')).queryByRole('button', { name: 'Pause KRA iTax' })).toBe(null);
    });

    it('pauses after the confirm dialog: the gateway is asked, a toast, the coverage read again', async () => {
      const { setPaused, onChanged } = renderActions([coverage({ system: 'kra' })]);

      fireEvent.click(within(row('kra')).getByRole('button', { name: 'Pause KRA iTax' }));
      const dialog = within(screen.getByRole('dialog'));
      dialog.getByRole('heading', { name: 'Pause KRA iTax?' });
      dialog.getByText('Lookups to KRA iTax will be marked unavailable until it is resumed.');
      dialog.getByText('Nothing is sent to KRA iTax while it is paused.');
      dialog.getByText('Cases keep flowing. Their Registry tab shows KRA iTax as unavailable.');
      dialog.getByText('Affected cases are re-checked every hour until it answers.');
      dialog.getByText('Recorded in the audit trail with your name.');
      fireEvent.click(dialog.getByRole('button', { name: 'Pause KRA iTax' }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBe(null);
      });
      expect(setPaused).toHaveBeenCalledWith('kra', true);
      expect(onChanged).toHaveBeenCalledOnce();
      screen.getByText('KRA iTax paused');
    });

    it('says what pausing IPRS does to onboarding', () => {
      renderActions([coverage({ system: 'iprs' })]);

      fireEvent.click(within(row('iprs')).getByRole('button', { name: 'Pause IPRS' }));

      const dialog = within(screen.getByRole('dialog'));
      dialog.getByText(
        'Declarants cannot confirm their identity at onboarding until it is resumed.',
      );
      expect(dialog.queryByText(/Registry tab/)).toBe(null);
    });

    it('keeps the dialog open when pausing fails, asking to try again', async () => {
      const { onChanged } = renderActions([coverage({ system: 'kra' })], {
        ok: false,
        error: { kind: 'unavailable', detail: null },
      });

      fireEvent.click(within(row('kra')).getByRole('button', { name: 'Pause KRA iTax' }));
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Pause KRA iTax' }),
      );

      await within(screen.getByRole('dialog')).findByText('Could not pause KRA iTax. Try again.');
      expect(onChanged).not.toHaveBeenCalled();
    });

    it('says when the caller may not pause (403)', async () => {
      renderActions([coverage({ system: 'kra' })], {
        ok: false,
        error: {
          kind: 'problem',
          problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
        },
      });

      fireEvent.click(within(row('kra')).getByRole('button', { name: 'Pause KRA iTax' }));
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Pause KRA iTax' }),
      );

      await within(screen.getByRole('dialog')).findByText(
        'You do not have access to pause or resume integrations.',
      );
    });

    it('resumes after the confirm dialog, which names the rate limit', async () => {
      const { setPaused } = renderActions([PAUSED_NTSA]);

      fireEvent.click(within(row('ntsa')).getByRole('button', { name: 'Resume NTSA TIMS' }));
      const dialog = within(screen.getByRole('dialog'));
      dialog.getByRole('heading', { name: 'Resume NTSA TIMS?' });
      dialog.getByText(
        'Lookups to NTSA TIMS start again, within its rate limit of 40 calls a minute.',
      );
      fireEvent.click(dialog.getByRole('button', { name: 'Resume NTSA TIMS' }));

      await screen.findByText('NTSA TIMS resumed');
      expect(setPaused).toHaveBeenCalledWith('ntsa', false);
    });

    it('says who paused a system and since when', () => {
      renderActions([PAUSED_NTSA]);

      screen.getByText(/Paused by Amina Wanjiru since 09:00\./);
      fireEvent.click(screen.getByRole('button', { name: 'NTSA TIMS' }));
      within(row('ntsa')).getByText(
        'Paused by Amina Wanjiru on 26 Sep 2026, 09:00. Nothing is sent until it is resumed.',
      );
    });
  });

  it('lists only the systems coverage returns', () => {
    renderView({
      result: ok([
        coverage({ system: 'kra' }),
        coverage({ system: 'payroll', cacheTtlSeconds: null }),
      ]),
    });

    expect(
      within(list())
        .getAllByRole('listitem')
        .map((item) => item.dataset.system),
    ).toEqual(['kra', 'payroll']);
  });

  describe('S15 instructed systems (payroll, ICMS)', () => {
    const INSTRUCTED = [
      coverage({
        system: 'kra',
        calls24h: 300,
        cacheHitRate: 0.5,
        lastSuccessAt: '2026-09-26T07:27:00Z',
      }),
      coverage({
        system: 'payroll',
        calls24h: 100,
        cacheTtlSeconds: null,
        timeoutMs: 5_000,
        lastSuccessAt: '2026-09-26T07:20:00Z',
      }),
      coverage({
        system: 'icms',
        calls24h: 4,
        cacheTtlSeconds: null,
        timeoutMs: 5_000,
        lastSuccessAt: '2026-09-26T07:10:00Z',
      }),
    ];

    const hitRate = (system: string) =>
      within(row(system)).getByText('Cache hit rate').nextElementSibling?.textContent;

    it('names and describes them, with Not cached for a hit rate', () => {
      renderView({ result: ok(INSTRUCTED) });

      const payroll = within(row('payroll'));
      payroll.getByText('Payroll (IPPD)');
      payroll.getByText('Salary stoppages and reinstatements of officers');
      expect(hitRate('payroll')).toBe('Not cached');
      const icms = within(row('icms'));
      icms.getByText('EACC ICMS');
      icms.getByText("Commissions' referrals, registered as EACC cases");
      expect(hitRate('icms')).toBe('Not cached');
      expect(hitRate('kra')).toBe('50%');
    });

    it('leaves them out of the cache hit rate tile', () => {
      renderView({ result: ok(INSTRUCTED) });

      const tiles = within(screen.getByRole('group', { name: 'Summary' }));
      tiles.getByText('404');
      tiles.getByText('50%');
    });

    it('expands to who runs them and Not cached for the cache lifetime', () => {
      renderView({ result: ok(INSTRUCTED) });

      fireEvent.click(screen.getByRole('button', { name: 'Payroll (IPPD)' }));
      const payroll = within(row('payroll'));
      payroll.getByText('Operated by');
      payroll.getByText('State Department for Public Service');
      expect(payroll.getByText('Cache lifetime').nextElementSibling?.textContent).toBe(
        'Not cached',
      );
      payroll.getByText('5 seconds per call');
    });

    it('words the pause dialog as instructions held back, not lookups or cached answers', () => {
      renderView({
        result: ok(INSTRUCTED),
        setPaused: vi.fn(() => Promise.resolve({ ok: true, data: coverage() } as const)),
      });

      fireEvent.click(within(row('payroll')).getByRole('button', { name: 'Pause Payroll (IPPD)' }));
      const dialog = within(screen.getByRole('dialog'));
      dialog.getByText(
        'Salary stoppages and reinstatements to Payroll (IPPD) get "unavailable" until it is resumed.',
      );
      dialog.getByText('Nothing is sent to Payroll (IPPD) while it is paused.');
      dialog.getByText('Adili does not queue them to send later.');
      dialog.getByText(
        'The review service keeps retrying them (at most 5 minutes apart) and they are sent once payroll is resumed.',
      );
      expect(dialog.queryByText(/decides whether|sent on its own/)).toBe(null);
      dialog.getByText('Recorded in the audit trail with your name.');
      expect(dialog.queryByText(/Lookups|cache|Registry tab/)).toBe(null);
    });

    it('says what a paused ICMS holds back, and what resuming it sends', () => {
      renderView({
        result: ok([
          coverage({
            system: 'icms',
            cacheTtlSeconds: null,
            paused: true,
            pausedBy: 'Amina Wanjiru',
            pausedAt: '2026-09-26T06:00:00Z',
            rateLimitPerMinute: 60,
          }),
        ]),
        setPaused: vi.fn(() => Promise.resolve({ ok: true, data: coverage() } as const)),
      });

      screen.getByText(
        /Referrals get "unavailable" until it is resumed; nothing is queued\. Pushes from EACC fail after a few quick retries; EACC must push those referrals again\./,
      );
      expect(screen.queryByText(/Lookups are marked unavailable|retried and sent/)).toBe(null);
      fireEvent.click(within(row('icms')).getByRole('button', { name: 'Resume EACC ICMS' }));
      const dialog = within(screen.getByRole('dialog'));
      dialog.getByText(
        'Referrals are sent to EACC ICMS again, within its rate limit of 60 calls a minute.',
      );
      dialog.getByText(
        'Nothing refused while it was paused is sent on its own. Pushes from EACC fail after a few quick retries; EACC must push those referrals again.',
      );
      expect(dialog.queryByText(/Waiting/)).toBe(null);
    });

    it('says a paused payroll gets what it refused from the review service within minutes of resume', () => {
      renderView({
        result: ok([
          coverage({
            system: 'payroll',
            cacheTtlSeconds: null,
            paused: true,
            pausedBy: 'Amina Wanjiru',
            pausedAt: '2026-09-26T06:00:00Z',
            rateLimitPerMinute: 60,
          }),
        ]),
        setPaused: vi.fn(() => Promise.resolve({ ok: true, data: coverage() } as const)),
      });

      screen.getByText(
        /Salary stoppages and reinstatements get "unavailable" until it is resumed; nothing is queued\. The review service keeps retrying them \(at most 5 minutes apart\) and they are sent once payroll is resumed\./,
      );
      fireEvent.click(
        within(row('payroll')).getByRole('button', { name: 'Resume Payroll (IPPD)' }),
      );
      const dialog = within(screen.getByRole('dialog'));
      dialog.getByText(
        'Salary stoppages and reinstatements are sent to Payroll (IPPD) again, within its rate limit of 60 calls a minute.',
      );
      dialog.getByText(
        'Those refused while it was paused are sent within about 5 minutes: the review service keeps retrying them.',
      );
      expect(dialog.queryByText(/sent on its own|decides whether/)).toBe(null);
    });
  });

  it('lists a system this build does not know by its id, without a description or operator', () => {
    renderView({
      result: ok([coverage(), coverage({ system: 'kenha' as IntegrationSystem, calls24h: 3 })]),
    });

    const unknown = within(row('kenha'));
    unknown.getByText('KENHA');
    expect(unknown.queryByText('Operated by')).toBe(null);
    within(row('kra')).getByText('KRA iTax');
  });

  it('draws the cache hit rate as a decorative bar beside its percentage', () => {
    renderView();

    const kra = within(row('kra'));
    const bar = kra.getByText('38%').nextElementSibling as HTMLElement;
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('38%');
  });

  it('says so when no system has an adapter', () => {
    renderView({ result: ok([]) });

    screen.getByText('No integrations yet');
  });
});
