// @vitest-environment jsdom
import { ACCESS_OFFICER } from '@adili/roles';
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_LEA_IDS as L } from '../../../server/access/lea-mock.server';
import {
  mockAccessClient,
  resetAccessMock,
  setAccessMockLatency,
} from '../../../server/access/mock.server';
import type { LeaRequest } from '../../../server/access/types';
import { findLeaRosterCandidates, verifyLea } from '../../../server/lea-requests';
import {
  loadLeaRequest,
  searchLeaRoster,
  verifyLeaRequest,
  withdrawLeaRequest,
} from '../../../server/lea-requests.server';
import { LeaRequestDetail } from './lea-request-detail';

const invalidate = vi.fn(() => Promise.resolve());

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
vi.mock('../../../server/access-requests', () => ({}));
vi.mock('../../../server/lea-requests', () => ({
  findLeaRosterCandidates: vi.fn(),
  verifyLea: vi.fn(),
}));

const client = () => mockAccessClient([ACCESS_OFFICER]);
const NOW = new Date().toISOString();

async function requestOf(id: string): Promise<LeaRequest> {
  const result = await loadLeaRequest(client(), id);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

function renderDetail(request: LeaRequest, readOnly = false) {
  render(
    <TooltipProvider>
      <ToastProvider>
        <LeaRequestDetail request={request} readOnly={readOnly} now={NOW} />
      </ToastProvider>
    </TooltipProvider>,
  );
}

const side = () => screen.getByRole('complementary', { name: 'Where the request stands' });

beforeAll(() => {
  setAccessMockLatency(0);
});
afterAll(() => {
  setAccessMockLatency(1);
});
beforeEach(() => {
  resetAccessMock();
  invalidate.mockClear();
  vi.mocked(findLeaRosterCandidates).mockImplementation(({ data }) =>
    searchLeaRoster(client(), data.requestId, data.q),
  );
  vi.mocked(verifyLea).mockImplementation(({ data }) =>
    verifyLeaRequest(
      client(),
      data.requestId,
      {
        provenanceConfirmed: true,
        reasonConfirmed: true,
        rosterRecordId: data.rosterRecordId,
        note: data.note,
      },
      data.idempotencyKey,
    ),
  );
});

describe('a law enforcement request, for the access officer (spec 10 FE-6, S11)', () => {
  it('shows the written request, its 14-day deadline and who has been told', async () => {
    renderDetail(await requestOf(L.received));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^LEA-PSC-2026-/);
    expect(screen.getByText('Law enforcement')).toBeTruthy();
    expect(screen.getByText('The declarant is not told of law enforcement requests.')).toBeTruthy();
    const written = screen.getByRole('region', { name: 'Written request' });
    expect(written.textContent).toContain('Directorate of Criminal Investigations');
    expect(written.textContent).toContain('DCI/ECU/142/2026');
    expect(written.textContent).toContain('Grace Nyambura Kamau');
    expect(written.textContent).not.toContain('Clarifications');
    // A short name for the tip; the regulation is its content.
    expect(within(written).getByRole('button', { name: 'About No Form K' })).toBeTruthy();
    const chip = document.querySelector('time[data-state]');
    expect(chip?.textContent).toMatch(/1\d days left/);
  });

  it('S11: verifies: both confirmations, the officer on the roster and a note', async () => {
    renderDetail(await requestOf(L.received));
    const card = within(side()).getByRole('region', { name: 'Verify' });
    expect(card.textContent).toContain('Sent from a provisioned DCI account: Suleiman Ali');
    fireEvent.click(within(card).getByRole('button', { name: 'Record verification' }));
    expect(card.textContent).toContain('Confirm the request comes from the agency account');
    expect(card.textContent).toContain('Confirm the request states its reason.');
    expect(card.textContent).toContain('Say what you checked.');
    expect(verifyLea).not.toHaveBeenCalled();

    // The file number Form K gave is searched at once.
    const record = await within(card).findByRole('radio', { name: /Grace Nyambura Kamau/ });
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Agency and officer confirmed' }));
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Reason for access stated' }));
    fireEvent.click(record);
    fireEvent.change(within(card).getByRole('textbox', { name: /Note/ }), {
      target: { value: 'Provisioned DCI account; case reference stated.' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Record verification' }));
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    expect(verifyLea).toHaveBeenCalledWith({
      data: expect.objectContaining({
        note: 'Provisioned DCI account; case reference stated.',
      }) as unknown,
    });
    expect((await requestOf(L.received)).status).toBe('verified');
  });

  it('S11: a retry keeps its Idempotency-Key; another roster record after a refusal gets a new one', async () => {
    renderDetail(await requestOf(L.received));
    const card = within(side()).getByRole('region', { name: 'Verify' });
    vi.mocked(verifyLea)
      .mockClear()
      .mockResolvedValueOnce({ ok: false, error: { kind: 'unavailable', detail: null } })
      .mockResolvedValueOnce({ ok: false, error: { kind: 'unavailable', detail: null } });
    const keys = () => vi.mocked(verifyLea).mock.calls.map(([call]) => call.data.idempotencyKey);
    const button = () =>
      within(card).getByRole<HTMLButtonElement>('button', { name: 'Record verification' });
    // The button is disabled while a call is out: click it only once the last one has answered,
    // or the click is lost and the next call never comes.
    const submit = async () => {
      await waitFor(() => {
        expect(button().disabled).toBe(false);
      });
      fireEvent.click(button());
    };

    fireEvent.click(await within(card).findByRole('radio', { name: /Grace Nyambura Kamau/ }));
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Agency and officer confirmed' }));
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Reason for access stated' }));
    fireEvent.change(within(card).getByRole('textbox', { name: /Note/ }), {
      target: { value: 'Provisioned DCI account; case reference stated.' },
    });
    await submit();
    await waitFor(() => {
      expect(keys()).toHaveLength(1);
    });
    // Tried again as it was: the same key, so the service answers once.
    await submit();
    await waitFor(() => {
      expect(keys()).toHaveLength(2);
    });
    expect(keys()[1]).toBe(keys()[0]);
    // Another record is another command: the service keeps the first answer under the old key.
    const search = within(card).getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'Adhiambo' } });
    const form = search.closest('form');
    if (form) fireEvent.submit(form);
    fireEvent.click(await within(card).findByRole('radio', { name: /Josephine Adhiambo Ouma/ }));
    await submit();
    await waitFor(() => {
      expect(keys()).toHaveLength(3);
    });
    expect(keys()[2]).not.toBe(keys()[1]);
  });

  it('offers a denial for a request that cannot be verified', async () => {
    renderDetail(await requestOf(L.received));
    const link = within(side()).getByRole('link', { name: 'Deny the request' });
    expect(link.getAttribute('href')).toBe(`/access/lea-requests/${L.received}/decide`);
  });

  it('a request its officer withdrew reads closed: who withdrew it and when, no action, the declarant not told', async () => {
    const officer = mockAccessClient(['law-enforcement'], 'Suleiman Ali');
    await withdrawLeaRequest(officer, L.received, crypto.randomUUID());
    renderDetail(await requestOf(L.received));

    expect(within(side()).getByText('Withdrawn by the agency')).toBeTruthy();
    expect(side().textContent).toMatch(/Suleiman Ali \(DCI\) withdrew it on .+, before a decision/);
    expect(within(side()).queryByRole('button')).toBeNull();
    expect(within(side()).queryByRole('link')).toBeNull();
    expect(
      screen.getByText('The declarant is not told. The request was withdrawn before a decision.'),
    ).toBeTruthy();
    expect(screen.queryByText('Decision due')).toBeNull();
  });

  it('marks a request undecided past its deadline as breached', async () => {
    renderDetail(await requestOf(L.breach));
    expect(screen.getByText('Deadline breached')).toBeTruthy();
  });

  it('opens Decide once verified; the supervisor only reads', async () => {
    renderDetail(await requestOf(L.verified));
    expect(within(side()).getByRole('link', { name: 'Decide' }).getAttribute('href')).toBe(
      `/access/lea-requests/${L.verified}/decide`,
    );
    // The verification, under its own title: who, and the officer identified.
    const verification = within(side()).getByRole('region', { name: 'Verification' });
    expect(within(verification).getByText('Verified by')).toBeTruthy();
    expect(verification.textContent).toContain('Lucy Wambui');
    expect(within(verification).getByText('Officer identified')).toBeTruthy();
    expect(verification.textContent).toContain('Peter Mwangi Kamau');
  });

  it('S11: after a grant, never tells the declarant and shows the package', async () => {
    renderDetail(await requestOf(L.granted));
    expect(screen.getByText('The declarant is not told of law enforcement requests.')).toBeTruthy();
    const register = screen.getByRole('list', { name: 'Access register' });
    expect(register.textContent).toContain('The declarant is not told.');
    expect(register.textContent).not.toContain('Declarant notified');
    const pkg = within(side()).getByRole('region', { name: 'Package' });
    expect(pkg.textContent).toContain('Suleiman Ali, DCI');
    expect(pkg.textContent).toContain('Downloads1');
    expect(within(side()).getByRole('region', { name: 'Decision' }).textContent).toContain(
      'Granted',
    );
  });

  it('after a denial, says the declarant was not told and the agency got the reasons', async () => {
    renderDetail(await requestOf(L.denied));
    expect(screen.getByText('The declarant is not told. DCI received the reasons.')).toBeTruthy();
    const register = screen.getByRole('list', { name: 'Access register' });
    expect(register.textContent).toMatch(/Case [^.]+\. The declarant is not told\./);
    expect(within(side()).queryByRole('region', { name: 'Package' })).toBeNull();
  });

  it('gives the supervisor where it stands instead of the forms', async () => {
    renderDetail(await requestOf(L.received), true);
    expect(within(side()).queryByRole('region', { name: 'Verify' })).toBeNull();
    expect(side().textContent).toContain('Waiting for the access officer to verify.');
    expect(screen.getByText('Read only')).toBeTruthy();
  });

  it('decision 2: a grant to an officer with no account asks nothing of the access officer', async () => {
    renderDetail(await requestOf(L.noAccount));
    expect(within(side()).queryByRole('region', { name: 'Notify in writing' })).toBeNull();
    expect(screen.queryByText(/written notice/i)).toBeNull();
    expect(screen.getByText('The declarant is not told of law enforcement requests.')).toBeTruthy();
  });

  it('decision 2: verifies to a roster record with no account', async () => {
    renderDetail(await requestOf(L.received));
    const search = within(side()).getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'Adhiambo' } });
    const form = search.closest('form');
    if (form) fireEvent.submit(form);
    const option = await within(side()).findByRole('radio', { name: /Josephine Adhiambo Ouma/ });
    expect((option as HTMLInputElement).disabled).toBe(false);
  });
});
