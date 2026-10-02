// @vitest-environment jsdom
import { LAW_ENFORCEMENT } from '@adili/roles';
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_COMMISSIONS, MOCK_LEA_IDS as L } from '../../server/access/lea-mock.server';
import {
  mockAccessClient,
  resetAccessMock,
  setAccessMockLatency,
} from '../../server/access/mock.server';
import type { LeaRequest } from '../../server/access/types';
import { getLeaPackageLink, sendLeaRequest } from '../../server/lea-requests';
import {
  listMyLeaRequests,
  loadLeaRequest,
  submitLeaRequest,
} from '../../server/lea-requests.server';
import { MyRequest } from './my-request';
import { MyRequests } from './my-requests';
import { NewRequestForm } from './new-request-form';
import { downloadFrom } from '../download';

const invalidate = vi.fn(() => Promise.resolve());

vi.mock('../download', () => ({ downloadFrom: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate }),
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [name, value]) => path.replace(`$${name}`, value),
        to,
      )}
      {...props}
    >
      {children}
    </a>
  ),
}));
vi.mock('../../server/access-requests', () => ({}));
vi.mock('../../server/lea-requests', () => ({
  sendLeaRequest: vi.fn(),
  getLeaPackageLink: vi.fn(),
}));

const lea = () => mockAccessClient([LAW_ENFORCEMENT], 'Suleiman Ali');
const NOW = new Date().toISOString();

function wrap(children: ReactNode) {
  return render(
    <TooltipProvider>
      <ToastProvider>{children}</ToastProvider>
    </TooltipProvider>,
  );
}

async function mine(): Promise<LeaRequest[]> {
  const result = await listMyLeaRequests(lea());
  if (!result.ok) throw new Error('not ok');
  return result.data;
}

async function requestOf(id: string): Promise<LeaRequest> {
  const result = await loadLeaRequest(lea(), id);
  if (!result.ok) throw new Error('not ok');
  return result.data;
}

beforeAll(() => {
  setAccessMockLatency(0);
});
afterAll(() => {
  setAccessMockLatency(1);
});
beforeEach(() => {
  resetAccessMock();
  invalidate.mockClear();
  vi.mocked(sendLeaRequest).mockImplementation(({ data }) =>
    submitLeaRequest(lea(), data.input, data.idempotencyKey),
  );
});

describe("the officer's requests (spec 10 FE-6)", () => {
  it('lists them latest first with the Commission, case, status and what comes next', async () => {
    wrap(<MyRequests result={{ ok: true, data: await mine() }} now={NOW} />);
    const table = screen.getByRole('table', { name: 'Your requests, latest first' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]?.textContent).toContain('DCI/ECU/142/2026');
    expect(rows[0]?.textContent).toContain('Received');
    expect(rows[0]?.querySelector('time')).not.toBeNull();
    const granted = rows.find((row) => row.textContent.includes('DCI/ECU/120/2026'));
    expect(
      within(granted ?? document.body).getByRole('button', { name: /Download the package/ }),
    ).toBeTruthy();
    const expired = rows.find((row) => row.textContent.includes('DCI/ECU/88/2026'));
    expect(expired?.textContent).toMatch(/Window closed/);
    const denied = rows.find((row) => row.textContent.includes('DCI/ECU/101/2026'));
    expect(denied?.textContent).toMatch(/Denied.*Decided/);
  });

  it('starts empty with a way to file the first one', () => {
    wrap(<MyRequests result={{ ok: true, data: [] }} now={NOW} />);
    expect(screen.getByText('No requests yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New request' }).getAttribute('href')).toBe(
      '/lea/requests/new',
    );
  });

  it('says when the list could not load', () => {
    wrap(
      <MyRequests result={{ ok: false, error: { kind: 'unavailable', detail: null } }} now={NOW} />,
    );
    expect(screen.getByText('We could not load your requests')).toBeTruthy();
  });

  it('a package not issued an hour after the grant turns from preparing to none issued', async () => {
    const granted = await requestOf(L.granted);
    if (!granted.decision) throw new Error('not decided');
    const fresh = {
      ...granted,
      package: null,
      decision: { ...granted.decision, decidedAt: NOW },
    };
    vi.useFakeTimers();
    try {
      wrap(<MyRequest request={fresh} now={NOW} />);
      expect(screen.getByText(/^Preparing your package/)).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(61 * 60_000);
      });
      expect(
        screen.getByText(
          'No package has been issued for this grant. Contact the Commission if you need the declaration.',
        ),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('downloads a granted package with a fresh link from documents', async () => {
    vi.mocked(getLeaPackageLink).mockResolvedValue({
      ok: true,
      data: { downloadUrl: '/api/mock-files/x', expiresAt: NOW, sha256: '0' },
    });
    wrap(<MyRequest request={await requestOf(L.granted)} now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download package' }));
    await waitFor(() => {
      expect(downloadFrom).toHaveBeenCalledWith('/api/mock-files/x');
    });
    expect(
      screen.getByText('Watermarked with your name. Every download is recorded.'),
    ).toBeTruthy();
  });

  it('says the download window closed', async () => {
    wrap(<MyRequest request={await requestOf(L.expired)} now={NOW} />);
    expect(screen.getByText(/^The download window closed on /)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download package' })).toBeNull();
  });

  it('shows a denial with its grounds and reasons', async () => {
    wrap(<MyRequest request={await requestOf(L.denied)} now={NOW} />);
    const decision = screen.getByRole('region', { name: 'Decision' });
    expect(decision.textContent).toContain('Denied');
    expect(decision.textContent).toContain('Does not promote the objectives of the Act');
    expect(decision.textContent).toContain('could not be identified on the roster');
  });

  it('shows where a waiting request stands', async () => {
    wrap(<MyRequest request={await requestOf(L.received)} now={NOW} />);
    const progress = screen.getByRole('list', { name: 'Progress' });
    expect(progress.textContent).toContain('Verified by the Commission');
    expect(progress.textContent).toContain('Waiting');
    expect(screen.getByRole('region', { name: 'Decision' }).textContent).toMatch(/Decision due/);
  });
});

describe('a new written request (S11)', () => {
  function fillIn() {
    fireEvent.click(screen.getByRole('combobox', { name: 'Commission' }));
    fireEvent.click(screen.getByRole('option', { name: 'Public Service Commission' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Grace Nyambura Kamau' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason for access' }), {
      target: { value: 'Investigation into housing tenders.' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Case reference/ }), {
      target: { value: 'DCI/ECU/150/2026' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: '2026' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Assets' }));
  }

  it('checks the request before sending it', () => {
    wrap(<NewRequestForm commissions={MOCK_COMMISSIONS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getByText('Choose the Commission.')).toBeTruthy();
    expect(screen.getByText('State the reason for access.')).toBeTruthy();
    expect(screen.getByText('Choose the Commission first: its years show here.')).toBeTruthy();
    expect(sendLeaRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole('checkbox', { name: /Clarifications/ })).toBeNull();
  });

  it('S11: sends it, then gives the LEA reference and the 14-day deadline', async () => {
    wrap(<NewRequestForm commissions={MOCK_COMMISSIONS} />);
    fillIn();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('heading', { name: 'Request sent' })).toBeTruthy();
    expect(screen.getByText(/Public Service Commission has 14 days to decide/)).toBeTruthy();
    expect(screen.getByText(/^LEA-PSC-2026-/)).toBeTruthy();
  });

  it("shows the service's refusal and keeps what was typed", async () => {
    wrap(<NewRequestForm commissions={MOCK_COMMISSIONS} />);
    fillIn();
    fireEvent.change(screen.getByRole('textbox', { name: /Case reference/ }), {
      target: { value: 'DCI/duplicate/2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Request not accepted')).toBeTruthy();
    expect(screen.getByText(/already open with PSC/)).toBeTruthy();
    expect(screen.getByText('Check the case reference.')).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' }).value).toBe(
      'Grace Nyambura Kamau',
    );
  });
});
