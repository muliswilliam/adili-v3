// @vitest-environment jsdom
import { LAW_ENFORCEMENT } from '@adili/roles';
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_COMMISSIONS, MOCK_LEA_IDS as L } from '../../server/access/lea-mock.server';
import {
  mockAccessClient,
  resetAccessMock,
  setAccessMockLatency,
} from '../../server/access/mock.server';
import type { LeaRequest } from '../../server/access/types';
import { getLeaPackageLink, sendLeaRequest, withdrawLea } from '../../server/lea-requests';
import {
  decideLeaRequest,
  listMyLeaRequests,
  loadLeaRequest,
  submitLeaRequest,
  withdrawLeaRequest,
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
  withdrawLea: vi.fn(),
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
  vi.mocked(withdrawLea).mockImplementation(({ data }) =>
    withdrawLeaRequest(lea(), data.requestId, data.idempotencyKey),
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

  it('a package being prepared says so; one whose issuing failed says so apart', async () => {
    const granted = await requestOf(L.granted);
    if (!granted.decision) throw new Error('not decided');
    const preparing = { ...granted, package: null, packageFailedAt: null };
    const { unmount } = wrap(<MyRequest request={preparing} now={NOW} />);
    expect(screen.getByText(/^Preparing your documents/)).toBeTruthy();
    unmount();

    wrap(<MyRequest request={await requestOf(L.failed)} now={NOW} />);
    expect(
      screen.getByText(
        'The package could not be issued. Contact the Commission if it is not ready soon.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
  });

  it('decision 1: a nil letter downloads like a package, under its own name', async () => {
    vi.mocked(getLeaPackageLink).mockResolvedValue({
      ok: true,
      data: { downloadUrl: '/api/mock-files/nil', expiresAt: NOW, sha256: '0' },
    });
    wrap(<MyRequest request={await requestOf(L.nilLetter)} now={NOW} />);
    const card = screen.getByRole('region', { name: 'Nil letter' });
    expect(card.textContent).toContain('No declarations held within the granted scope.');
    fireEvent.click(screen.getByRole('button', { name: 'Download letter' }));
    await waitFor(() => {
      expect(downloadFrom).toHaveBeenCalledWith('/api/mock-files/nil');
    });
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

describe('withdrawing a request before its decision (user decision 5)', () => {
  const officer = () => mockAccessClient(['access-officer'], 'Lucy Wambui');

  it('asks first, then withdraws it, says so and reloads the page', async () => {
    wrap(<MyRequest request={await requestOf(L.received)} now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
    const dialog = await screen.findByRole('dialog', { name: /^Withdraw LEA-PSC-2026-/ });
    expect(dialog.textContent).toContain('The Commission stops work on it');
    expect(dialog.textContent).toContain('This cannot be undone');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw request' }));

    expect(await screen.findByText(/^LEA-PSC-2026-\S+ withdrawn$/)).toBeTruthy();
    expect(invalidate).toHaveBeenCalled();
    expect(withdrawLea).toHaveBeenCalledWith({
      data: { requestId: L.received, idempotencyKey: expect.any(String) as string },
    });
    const withdrawn = await requestOf(L.received);
    expect(withdrawn.status).toBe('withdrawn');
  });

  it('keeps the request when the officer thinks better of it', async () => {
    wrap(<MyRequest request={await requestOf(L.received)} now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep request' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(withdrawLea).not.toHaveBeenCalled();
  });

  it('decided meanwhile (409 request-decided): closes the dialog, says why, reloads', async () => {
    const page = await requestOf(L.received);
    await decideLeaRequest(
      officer(),
      L.received,
      { outcome: 'deny', grounds: ['not-objectives'], reasons: 'Not shown.' },
      crypto.randomUUID(),
    );
    wrap(<MyRequest request={page} now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw request' }));

    expect(
      await screen.findByText(
        'The Commission has decided this request, so it can no longer be withdrawn.',
      ),
    ).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it('the service down: stays in the dialog to try again with the same key', async () => {
    vi.mocked(withdrawLea).mockResolvedValue({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    });
    wrap(<MyRequest request={await requestOf(L.received)} now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw request' }));
    expect(
      await within(dialog).findByText(
        'We could not withdraw the request. Nothing changed. Try again.',
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw request' }));
    await waitFor(() => {
      expect(withdrawLea).toHaveBeenCalledTimes(2);
    });
    const [first, second] = vi.mocked(withdrawLea).mock.calls;
    expect(second?.[0]).toEqual(first?.[0]);
  });

  it('offers no withdrawal once decided; a withdrawn request says when, in the list too', async () => {
    wrap(<MyRequest request={await requestOf(L.denied)} now={NOW} />);
    expect(screen.queryByRole('button', { name: 'Withdraw request' })).toBeNull();

    await withdrawLeaRequest(lea(), L.received, crypto.randomUUID());
    const withdrawn = await requestOf(L.received);
    wrap(<MyRequest request={withdrawn} now={NOW} />);
    const decision = screen.getAllByRole('region', { name: 'Decision' }).at(-1);
    expect(decision?.textContent).toMatch(/You withdrew this request on .+, before a decision/);
    expect(screen.getAllByRole('list', { name: 'Progress' }).at(-1)?.textContent).toContain(
      'Withdrawn',
    );

    wrap(<MyRequests result={{ ok: true, data: await mine() }} now={NOW} />);
    const row = screen
      .getAllByRole('row')
      .find((each) => each.textContent.includes('DCI/ECU/142/2026'));
    expect(row?.textContent).toMatch(/Withdrawn \d/);
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

  it("S11: sends it, then gives the LEA reference and the Commission's deadline", async () => {
    wrap(<NewRequestForm commissions={MOCK_COMMISSIONS} />);
    fillIn();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('heading', { name: 'Request sent' })).toBeTruthy();
    expect(screen.getByText(/Public Service Commission has 14 days to decide/)).toBeTruthy();
    expect(screen.getByText(/^LEA-PSC-2026-/)).toBeTruthy();
  });

  it('a retry keeps its Idempotency-Key; a request changed after an outage gets a new one', async () => {
    vi.mocked(sendLeaRequest)
      .mockClear()
      .mockResolvedValueOnce({ ok: false, error: { kind: 'unavailable', detail: null } })
      .mockResolvedValueOnce({ ok: false, error: { kind: 'unavailable', detail: null } })
      .mockResolvedValueOnce({ ok: false, error: { kind: 'unavailable', detail: null } });
    const keys = () =>
      vi.mocked(sendLeaRequest).mock.calls.map(([call]) => call.data.idempotencyKey);
    const send = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    };
    wrap(<NewRequestForm commissions={MOCK_COMMISSIONS} />);
    fillIn();
    send();
    await waitFor(() => {
      expect(keys()).toHaveLength(1);
    });
    send();
    await waitFor(() => {
      expect(keys()).toHaveLength(2);
    });
    expect(keys()[1]).toBe(keys()[0]);
    fireEvent.change(screen.getByRole('textbox', { name: /Case reference/ }), {
      target: { value: 'DCI/ECU/151/2026' },
    });
    send();
    await waitFor(() => {
      expect(keys()).toHaveLength(3);
    });
    expect(keys()[2]).not.toBe(keys()[1]);
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
