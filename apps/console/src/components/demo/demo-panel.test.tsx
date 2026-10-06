// @vitest-environment jsdom
import { DEMO_CHECKPOINTS } from '@adili/demo-auth';
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DemoState } from '../../server/demo/demo';
import type { DemoInbox, DemoPanelState, DemoVerifyCodes } from '../../server/demo/panel';
import { DemoContext } from './demo-context';
import { DemoPanel } from './demo-panel';

const getDemoPanel = vi.fn<() => Promise<DemoPanelState | null>>();
const getDemoInbox = vi.fn<() => Promise<DemoInbox | null>>();
const getDemoVerifyCodes = vi.fn<() => Promise<DemoVerifyCodes | null>>();
const resetDemo = vi.fn();
const setDemoRegistryPaused = vi.fn();
vi.mock('../../server/demo/panel', () => ({
  getDemoPanel: () => getDemoPanel(),
  getDemoInbox: () => getDemoInbox(),
  getDemoVerifyCodes: () => getDemoVerifyCodes(),
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
  getDemoVerifyCodes.mockReset();
  getDemoVerifyCodes.mockResolvedValue({ state: 'not-seeded' });
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

  it('lists a document in every verify status with its code and verify page', async () => {
    getDemoPanel.mockResolvedValue(panel('button'));
    getDemoVerifyCodes.mockResolvedValue({
      state: 'ready',
      documents: [
        {
          status: 'revoked',
          what: 'JSC clarification letter, issued in error and withdrawn',
          verificationId: 'ADL-REVOKED',
          verifyUrl: 'https://verify.test/v/ADL-REVOKED',
        },
        {
          status: 'expired',
          what: 'JSC access package past its validity',
          verificationId: 'ADL-EXPIRED',
          verifyUrl: 'https://verify.test/v/ADL-EXPIRED',
        },
        {
          status: 'hash-mismatch',
          what: "Tampered copy of Otieno's slip",
          verificationId: 'ADL-VALID',
          verifyUrl: 'https://verify.test/v/ADL-VALID',
          file: 'tampered-acknowledgement-slip.pdf',
        },
      ],
    });
    renderPanel(signedIn);

    fireEvent.click(screen.getByRole('button', { name: 'Demo panel' }));

    const codes = await screen.findByRole('list', { name: 'Verify codes' });
    const [revoked, expired, tampered] = within(codes).getAllByRole('listitem');
    if (!revoked || !expired || !tampered) throw new Error('Missing a verify code');
    expect(revoked.textContent).toContain('Revoked');
    expect(revoked.textContent).toContain('ADL-REVOKED');
    expect(
      within(revoked)
        .getByRole('link', { name: "Open the revoked document's verify page" })
        .getAttribute('href'),
    ).toBe('https://verify.test/v/ADL-REVOKED');
    expect(within(revoked).getByRole('button', { name: 'Copy the revoked code' })).toBeTruthy();
    expect(expired.textContent).toContain('ADL-EXPIRED');
    expect(tampered.textContent).toContain('Does not match');
    const download = within(tampered).getByRole('link', {
      name: 'Download tampered-acknowledgement-slip.pdf',
    });
    expect(download.getAttribute('href')).toBe(
      '/demo/verify-files/tampered-acknowledgement-slip.pdf',
    );
  });

  it('says how to write the verify codes when the stack has none', async () => {
    getDemoPanel.mockResolvedValue(panel('button'));
    renderPanel(signedIn);

    fireEvent.click(screen.getByRole('button', { name: 'Demo panel' }));

    expect((await screen.findByText(/No codes on this stack yet/)).textContent).toContain(
      'pnpm demo:seed --only verify',
    );
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

  it('resets only once confirmed, then covers the console while it restarts (#622)', async () => {
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

    fireEvent.click(within(row).getByRole('button', { name: 'Reset to 1-after-filing' }));
    expect(resetDemo).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole('button', { name: 'Reset now to 1-after-filing' }));

    expect(resetDemo).toHaveBeenCalledWith({ data: { checkpoint: '1-after-filing' } });
    const resetting = await screen.findByRole('status', {
      name: /Resetting the demo to 1-after-filing/,
    });
    expect(resetting.textContent).toContain('everyone is signed out');
    expect(resetting.textContent).toContain('back in about 4 minutes');
    // The drawer is gone: the reset is not undone, or hidden, by closing it.
    expect(screen.queryByRole('heading', { name: 'Demo panel' })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("names each checkpoint's reset buttons after the checkpoint", async () => {
    getDemoPanel.mockResolvedValue(panel('button'));
    renderPanel(signedIn);
    fireEvent.click(screen.getByRole('button', { name: 'Demo panel' }));
    await screen.findByText('0-start');

    const resets = screen
      .getAllByRole('button', { name: /^Reset to / })
      .map((button) => button.getAttribute('aria-label'));
    expect(resets).toEqual(
      panel('button').checkpoints.map((checkpoint) => `Reset to ${checkpoint.name}`),
    );
    // The visible label stays short, and the accessible name starts with it.
    expect(screen.getByRole('button', { name: 'Reset to 0-start' }).textContent).toBe('Reset');

    fireEvent.click(screen.getByRole('button', { name: 'Reset to 0-start' }));
    expect(screen.getByRole('button', { name: 'Cancel reset to 0-start' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset now to 0-start' })).toBeTruthy();
  });

  it('shows why a reset did not start', async () => {
    getDemoPanel.mockResolvedValue(panel('button'));
    resetDemo.mockResolvedValue({ ok: false, message: 'No complete checkpoint 0-start' });
    renderPanel(signedIn);
    fireEvent.click(screen.getByRole('button', { name: 'Demo panel' }));
    const row = (await screen.findByText('0-start')).closest('li');
    if (!row) throw new Error('no checkpoint row');

    fireEvent.click(within(row).getByRole('button', { name: 'Reset to 0-start' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Reset now to 0-start' }));

    expect(await screen.findByText('No complete checkpoint 0-start')).toBeTruthy();
  });

  it('gives the command to run on a local stack', async () => {
    getDemoPanel.mockResolvedValue(panel('command'));
    renderPanel(signedIn);
    fireEvent.click(screen.getByRole('button', { name: 'Demo panel' }));

    expect(
      await screen.findByRole('button', { name: 'Copy pnpm demo:reset 2-after-review' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Reset/ })).toBeNull();
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
