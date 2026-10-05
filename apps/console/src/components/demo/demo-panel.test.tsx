// @vitest-environment jsdom
import { DEMO_CHECKPOINTS } from '@adili/demo-auth';
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DemoState } from '../../server/demo/demo';
import type { DemoInbox, DemoPanelState } from '../../server/demo/panel';
import { DemoContext } from './demo-context';
import { DemoPanel } from './demo-panel';

const getDemoPanel = vi.fn<() => Promise<DemoPanelState | null>>();
const getDemoInbox = vi.fn<() => Promise<DemoInbox | null>>();
const resetDemo = vi.fn();
const setDemoRegistryPaused = vi.fn();
vi.mock('../../server/demo/panel', () => ({
  getDemoPanel: () => getDemoPanel(),
  getDemoInbox: () => getDemoInbox(),
  resetDemo: (...args: unknown[]) => resetDemo(...args) as unknown,
  setDemoRegistryPaused: (...args: unknown[]) => setDemoRegistryPaused(...args) as unknown,
}));

const panel = (reset: DemoPanelState['reset']): DemoPanelState => ({
  checkpoints: [...DEMO_CHECKPOINTS],
  reset,
  registries: [
    { system: 'kra', label: 'KRA', paused: false },
    { system: 'ntsa', label: 'NTSA', paused: true },
    { system: 'brs', label: 'BRS', paused: null },
    { system: 'ardhisasa', label: 'ArdhiSasa', paused: false },
  ],
});

function renderPanel(demo: DemoState | null) {
  return render(
    <TooltipProvider>
      <ToastProvider>
        <DemoContext value={demo}>
          <DemoPanel />
        </DemoContext>
      </ToastProvider>
    </TooltipProvider>,
  );
}

const signedIn: DemoState = { accounts: [], current: 'reviewer' };

beforeEach(() => {
  getDemoPanel.mockReset();
  getDemoInbox.mockReset();
  getDemoInbox.mockResolvedValue({ sms: [], email: [] });
  resetDemo.mockReset();
  setDemoRegistryPaused.mockReset();
});
afterEach(cleanup);

describe('DemoPanel (#621)', () => {
  it('offers the files the beats upload, served by the stack (#679)', async () => {
    getDemoPanel.mockResolvedValue(panel('button'));
    renderPanel(signedIn);

    fireEvent.click(screen.getByRole('button', { name: 'Demo panel' }));

    const files = await screen.findByRole('list', { name: 'Demo files' });
    const roster = within(files).getByRole('link', { name: 'Download psc-roster.csv' });
    expect(roster.getAttribute('href')).toBe('/demo/files/psc-roster.csv');
    expect(roster.getAttribute('download')).toBe('psc-roster.csv');
    expect(within(files).getAllByRole('link')).toHaveLength(4);
  });

  it('is absent outside demo mode', () => {
    const { container } = renderPanel(null);
    expect(container.innerHTML).toBe('');
  });

  it('is absent until a demo account signs in', () => {
    const { container } = renderPanel({ accounts: [], current: null });
    expect(container.innerHTML).toBe('');
  });

  it('lists the checkpoints and the registries with their state', async () => {
    getDemoPanel.mockResolvedValue(panel('button'));
    renderPanel(signedIn);

    fireEvent.click(screen.getByRole('button', { name: 'Demo panel' }));

    const dialog = await screen.findByRole('dialog', { name: 'Demo panel' });
    for (const checkpoint of DEMO_CHECKPOINTS) {
      expect(within(dialog).getByText(checkpoint.name)).toBeTruthy();
    }
    expect(within(dialog).getByRole('switch', { name: 'KRA' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(within(dialog).getByRole('switch', { name: 'NTSA' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(within(dialog).getByText('Unreachable')).toBeTruthy();
  });

  it('pauses a registry', async () => {
    getDemoPanel.mockResolvedValue(panel('button'));
    setDemoRegistryPaused.mockResolvedValue(true);
    renderPanel(signedIn);
    fireEvent.click(screen.getByRole('button', { name: 'Demo panel' }));

    fireEvent.click(await screen.findByRole('switch', { name: 'KRA' }));

    expect(setDemoRegistryPaused).toHaveBeenCalledWith({ data: { system: 'kra', paused: true } });
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'KRA' }).getAttribute('aria-checked')).toBe(
        'false',
      );
    });
  });

  it('resets only once confirmed, and says the console restarts', async () => {
    getDemoPanel.mockResolvedValue(panel('button'));
    resetDemo.mockResolvedValue({ ok: true });
    vi.stubGlobal(
      'fetch',
      // The console never comes back in this test: the page keeps waiting.
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    renderPanel(signedIn);
    fireEvent.click(screen.getByRole('button', { name: 'Demo panel' }));
    const row = (await screen.findByText('1-after-filing')).closest('li');
    if (!row) throw new Error('no checkpoint row');

    fireEvent.click(within(row).getByRole('button', { name: 'Reset' }));
    expect(resetDemo).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole('button', { name: 'Reset now' }));

    expect(resetDemo).toHaveBeenCalledWith({ data: { checkpoint: '1-after-filing' } });
    expect(await screen.findByText('Resetting the demo to 1-after-filing')).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('shows why a reset did not start', async () => {
    getDemoPanel.mockResolvedValue(panel('button'));
    resetDemo.mockResolvedValue({ ok: false, message: 'No complete checkpoint 0-start' });
    renderPanel(signedIn);
    fireEvent.click(screen.getByRole('button', { name: 'Demo panel' }));
    const row = (await screen.findByText('0-start')).closest('li');
    if (!row) throw new Error('no checkpoint row');

    fireEvent.click(within(row).getByRole('button', { name: 'Reset' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Reset now' }));

    expect(await screen.findByText('No complete checkpoint 0-start')).toBeTruthy();
  });

  it('gives the command to run on a local stack', async () => {
    getDemoPanel.mockResolvedValue(panel('command'));
    renderPanel(signedIn);
    fireEvent.click(screen.getByRole('button', { name: 'Demo panel' }));

    expect(
      await screen.findByRole('button', { name: 'Copy pnpm demo:reset 2-after-review' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  });

  it('shows the codes just sent by text and email, newest first', async () => {
    getDemoPanel.mockResolvedValue(panel('button'));
    getDemoInbox.mockResolvedValue({
      sms: [
        {
          id: 's2',
          to: '+254700000099',
          text: 'Your Adili code is 482913',
          code: '482913',
          receivedAt: '2026-10-05T07:42:00Z',
        },
        {
          id: 's1',
          to: '+254700000098',
          text: 'Welcome to Adili',
          code: null,
          receivedAt: '2026-10-05T07:40:00Z',
        },
      ],
      email: null,
    });
    renderPanel(signedIn);
    fireEvent.click(screen.getByRole('button', { name: 'Demo panel' }));

    const sms = await screen.findByRole('list', { name: 'Text messages' });
    const rows = within(sms).getAllByRole('listitem');
    expect(rows[0]?.textContent).toContain('482913');
    expect(rows[0]?.textContent).toContain('10:42');
    expect(within(sms).getByRole('button', { name: 'Copy code 482913' })).toBeTruthy();
    expect(rows[1]?.textContent).toContain('Welcome to Adili');
    expect(screen.getByText('Mailpit did not answer.')).toBeTruthy();
  });
});
