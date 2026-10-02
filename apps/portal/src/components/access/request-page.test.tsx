// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMyPackageDownload } from '../../server/access-requests';
import type { AccessRequest, AccessRequestStatus } from '../../server/access/types';
import { downloadFrom } from '../download';
import { RequestPage } from './request-page';
import { IDS, NOW, seededRequest } from './testing';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);
vi.mock('../../server/access-requests', () => ({ getMyPackageDownload: vi.fn() }));
vi.mock('../download', async () => (await import('../declaration/testing-mocks')).downloadMock());

const packageDownload = vi.mocked(getMyPackageDownload);

// The page reads the package's window against the browser's clock after the first render.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function show(request: AccessRequest, onWithdraw = vi.fn(), onDownloaded = vi.fn()) {
  render(
    <ToastProvider>
      <RequestPage
        request={request}
        now={NOW}
        onWithdraw={onWithdraw}
        onDownloaded={onDownloaded}
      />
    </ToastProvider>,
  );
  return { onWithdraw, onDownloaded };
}

/** The Progress card's stage with this visible title and screen reader state. */
const stage = (text: string) =>
  screen.queryAllByText(
    (_, element) => element?.tagName === 'SPAN' && element.textContent === text,
  )[0];

/** Each seeded request, with its badge and the banner's lead. */
const CASES: { key: keyof typeof IDS; status: AccessRequestStatus; badge: string; lead: RegExp }[] =
  [
    {
      key: 'submitted',
      status: 'submitted',
      badge: 'Submitted',
      lead: /Public Service Commission received your request on 2 Oct 2026\./,
    },
    {
      key: 'pending',
      status: 'pending-applicant-verification',
      badge: 'Awaiting identity verification',
      lead: /Waiting for Public Service Commission to verify your passport\./,
    },
    {
      key: 'unresolved',
      status: 'officer-unresolved',
      badge: 'Officer being identified',
      lead: /Teachers Service Commission is identifying the officer on its roster\./,
    },
    {
      key: 'notified',
      status: 'awaiting-representations',
      badge: 'Declarant notified',
      lead: /Public Service Commission has notified the officer\./,
    },
    {
      key: 'deciding',
      status: 'under-decision',
      badge: 'Under decision',
      lead: /Public Service Commission is deciding\./,
    },
    {
      key: 'granted',
      status: 'granted',
      badge: 'Granted',
      lead: /Public Service Commission granted your request\./,
    },
    {
      key: 'partial',
      status: 'partially-granted',
      badge: 'Partially granted',
      lead: /Public Service Commission granted part of your request\./,
    },
    {
      key: 'denied',
      status: 'denied',
      badge: 'Denied',
      lead: /Public Service Commission denied your request\./,
    },
    {
      key: 'cannot',
      status: 'cannot-identify',
      badge: 'Cannot identify officer',
      lead: /could not identify this officer on its roster, so the request is closed\./,
    },
    {
      key: 'withdrawn',
      status: 'withdrawn',
      badge: 'Withdrawn',
      lead: /You withdrew this request on/,
    },
  ];

const OPEN = new Set(['submitted', 'pending', 'unresolved', 'notified', 'deciding', 'late']);

describe('RequestPage (S17)', () => {
  it.each(CASES)('shows a $status request with its badge and banner', async (each) => {
    const request = await seededRequest(IDS[each.key]);
    expect(request.status).toBe(each.status);
    show(request);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(request.formK.partII.name);
    expect(screen.getAllByText(each.badge).length).toBeGreaterThan(0);
    expect(screen.getByText(each.lead)).toBeTruthy();
    expect(screen.getByText(request.formK.partIII.reason)).toBeTruthy();
    const withdraw = screen.queryByRole('button', { name: 'Withdraw request' });
    expect(withdraw !== null).toBe(OPEN.has(each.key));
  });

  it('S8: offers withdrawing until a decision', async () => {
    const { onWithdraw } = show(await seededRequest(IDS.notified));
    screen.getByRole('button', { name: 'Withdraw request' }).click();
    expect(onWithdraw).toHaveBeenCalledOnce();
  });

  it('shows the decision clock while open, late in red once past the due date', async () => {
    show(await seededRequest(IDS.late));
    expect(screen.getByText(/^Decision \d+ days late$/)).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Decision clock' })).toBeTruthy();
  });

  it('cites a denial’s grounds from Regulation 24 and the court relief', async () => {
    show(await seededRequest(IDS.denied));
    expect(screen.getByText('Frivolous, vexatious or scandalous')).toBeTruthy();
    expect(screen.getByText('(c) the request is frivolous, vexatious or scandalous;')).toBeTruthy();
    expect(screen.getByText('Does not promote the objectives of the Act')).toBeTruthy();
    expect(
      screen.getByText('If you disagree with the decision, you may seek relief from the court.'),
    ).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows what a partial grant covers', async () => {
    show(await seededRequest(IDS.partial));
    expect(screen.getByText('Against public interest')).toBeTruthy();
    expect(screen.getByText('Granted')).toBeTruthy();
  });

  it('offers a new request with the details after the officer could not be identified', async () => {
    const request = await seededRequest(IDS.cannot);
    show(request);
    const link = screen.getByRole('link', { name: 'New request with these details' });
    expect(link.getAttribute('href')).toBe('/access/requests/new');
    const progress = screen.getByRole('heading', { name: 'Progress' }).closest('div');
    expect(
      within(progress as HTMLElement).getByText('Officer could not be identified'),
    ).toBeTruthy();
  });

  it('shows the passport check as the current stage while it waits', async () => {
    show(await seededRequest(IDS.pending));
    expect(stage('Passport verification, now')).toBeTruthy();
    expect(stage('Officer identified, to come')).toBeTruthy();
  });
});

describe('RequestPage package (#261, S7)', () => {
  it('offers the granted package with its expiry date and days left', async () => {
    const request = await seededRequest(IDS.granted);
    show(request);
    expect(screen.getByRole('heading', { name: 'Package' })).toBeTruthy();
    expect(screen.getByText('Confidential')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
    expect(screen.getByText(/^Expires \d+ Oct 2026, \d\d:\d\d · 13 days left$/)).toBeTruthy();
    expect(screen.getByText('Not downloaded yet')).toBeTruthy();
    expect(
      // The matcher reads the date's no-break spaces as spaces.
      screen.getByText(/Download your package by \d+ Oct 2026, \d\d:\d\d\./),
    ).toBeTruthy();
    expect(stage('Package ready, now')).toBeTruthy();
    expect(
      screen.getByText(/without Public Service Commission’s permission is an offence/),
    ).toBeTruthy();
  });

  it('says what a partial grant left out, with the window ending in 2 days', async () => {
    show(await seededRequest(IDS.partial));
    expect(screen.getByText(/^Expires .* · 2 days left$/)).toBeTruthy();
    expect(
      screen.getByText(/Some of what you asked for was not granted\. Download your package by/),
    ).toBeTruthy();
  });

  it('counts down in hours and minutes on the window’s last day, ticking', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    show(await seededRequest(IDS.expiring));
    expect(screen.getByText('Expires in 5 h 12 min')).toBeTruthy();
    expect(screen.getByText('Expires in 6 hours')).toBeTruthy();
    expect(screen.getByText(/Download your package today, by \d\d:\d\d\./)).toBeTruthy();
    expect(screen.getByText(/^Downloaded 1 time · last /)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(5 * 3_600_000 + 11 * 60_000);
    });
    expect(screen.getByText('Expires in 1 min')).toBeTruthy();
    expect(screen.getByText('Expires in 1 minute')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(screen.getByText(/^Expired \d+ Oct 2026$/)).toBeTruthy();
  });

  it('shows an expired package without Download, saying whom to contact', async () => {
    show(await seededRequest(IDS.expired));
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(screen.getByText(/^Expired \d+ Sep 2026$/)).toBeTruthy();
    expect(screen.getByText(/^Downloaded 2 times · last /)).toBeTruthy();
    expect(
      screen.getByText('Contact Teachers Service Commission if you still need it.'),
    ).toBeTruthy();
    expect(screen.getByText(/The download window closed on \d+ Sep 2026\./)).toBeTruthy();
    expect(stage('Download window closed, done')).toBeTruthy();
  });

  it('says the package is being prepared until it is issued', async () => {
    show(await seededRequest(IDS.preparing));
    expect(screen.getByText('Preparing your package…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(screen.getByText(/Your package is being prepared\./)).toBeTruthy();
  });

  it('says no package was issued once an hour has passed since the grant without one', async () => {
    show(await seededRequest(IDS.unissued));
    expect(
      screen.getByText('No package has been issued for this grant.', { selector: 'p' }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Contact Public Service Commission if you still need it\./),
    ).toBeTruthy();
    expect(screen.queryByText('Preparing your package…')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(stage('Package, stopped')).toBeTruthy();
  });

  it('describes Download by when the window ends', async () => {
    show(await seededRequest(IDS.granted));
    const button = screen.getByRole('button', { name: 'Download' });
    const described = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toMatch(/^Expires \d+ Oct 2026, \d\d:\d\d · 13 days left$/);
  });

  it('shows no package for a denial', async () => {
    show(await seededRequest(IDS.denied));
    expect(screen.queryByRole('heading', { name: 'Package' })).toBeNull();
  });

  it('downloads from a fresh link and says each download is recorded', async () => {
    const request = await seededRequest(IDS.granted);
    packageDownload.mockResolvedValue({ status: 'ok', downloadUrl: '/package.pdf' });
    const { onDownloaded } = show(request);
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByText('Download started. Each download is recorded.')).toBeTruthy();
    expect(packageDownload).toHaveBeenCalledWith({
      data: { documentId: request.package?.documentId },
    });
    expect(downloadFrom).toHaveBeenCalledWith('/package.pdf');
    expect(onDownloaded).toHaveBeenCalledOnce();
  });

  it('says so when the link could not be had, and lets the applicant try again', async () => {
    packageDownload.mockResolvedValue({ status: 'unavailable' });
    show(await seededRequest(IDS.granted));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    const failed = await screen.findByText('We could not start the download. Try again.');
    expect(failed.getAttribute('role')).toBe('alert');
    expect(downloadFrom).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
  });

  it('closes the window on the page when documents answers 410', async () => {
    packageDownload.mockResolvedValue({ status: 'window-closed' });
    show(await seededRequest(IDS.granted));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByText('The download window has closed.')).toBeTruthy();
    expect(screen.getByText('The package can no longer be downloaded.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(stage('Download window closed, done')).toBeTruthy();
  });
});
