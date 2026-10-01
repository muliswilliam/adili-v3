// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AccessRequest, AccessRequestStatus } from '../../server/access/types';
import { RequestPage } from './request-page';
import { IDS, NOW, seededRequest } from './testing';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);

function show(request: AccessRequest, onWithdraw = vi.fn()) {
  render(
    <ToastProvider>
      <RequestPage request={request} now={NOW} onWithdraw={onWithdraw} />
    </ToastProvider>,
  );
  return { onWithdraw };
}

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
    expect(screen.getByText('Frivolous, vexatious or scandalous (Regulation 24(c))')).toBeTruthy();
    expect(
      screen.getByText('Does not promote the objectives of the Act (Regulation 24(d))'),
    ).toBeTruthy();
    expect(
      screen.getByText('If you disagree with the decision, you may seek relief from the court.'),
    ).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows what a partial grant covers', async () => {
    show(await seededRequest(IDS.partial));
    expect(screen.getByText('Against the public interest (Regulation 24(a))')).toBeTruthy();
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
    const stage = (text: string) =>
      screen.getAllByText(
        (_, element) => element?.tagName === 'SPAN' && element.textContent === text,
      )[0];
    expect(stage('Passport verification, now')).toBeTruthy();
    expect(stage('Officer identified, to come')).toBeTruthy();
  });
});
