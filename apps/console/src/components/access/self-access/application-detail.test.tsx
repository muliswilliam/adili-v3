// @vitest-environment jsdom
import { ACCESS_OFFICER, SUPERVISOR } from '@adili/roles';
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockAccessClient } from '../../../server/access/mock.server';
import {
  MOCK_SELF_ACCESS_IDS as A,
  mockSelfAccessDocumentsClient,
  resetSelfAccessMock,
  setSelfAccessMockLatency,
} from '../../../server/access/self-access-mock.server';
import { getCertifiedCopyLink, markSelfAccessDelivered } from '../../../server/self-access';
import {
  copyDownload,
  loadApplication,
  markDelivered,
  type SelfAccessApplicationDetail,
} from '../../../server/self-access.server';
import { ApplicationDetailView } from './application-detail';

const invalidate = vi.fn(() => Promise.resolve());

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }));
// The shared side cards import the request page's server functions.
vi.mock('../../../server/access-requests', () => ({}));
vi.mock('../../../server/self-access', () => ({
  getCertifiedCopyLink: vi.fn(),
  markSelfAccessDelivered: vi.fn(),
}));

const officer = () => mockAccessClient([ACCESS_OFFICER]);

async function applicationOf(id: string, client = officer()): Promise<SelfAccessApplicationDetail> {
  const result = await loadApplication(client, id);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

function renderDetail(application: SelfAccessApplicationDetail, readOnly = false) {
  render(
    <TooltipProvider>
      <ToastProvider>
        <ApplicationDetailView application={application} readOnly={readOnly} commissionCode="PSC" />
      </ToastProvider>
    </TooltipProvider>,
  );
}

const copyCard = () => screen.getByRole('region', { name: 'Certified copy' });

beforeAll(() => {
  setSelfAccessMockLatency(0);
});
afterAll(() => {
  setSelfAccessMockLatency(1);
});
beforeEach(() => {
  resetSelfAccessMock();
  invalidate.mockClear();
  vi.mocked(getCertifiedCopyLink).mockImplementation(({ data }) =>
    copyDownload(mockSelfAccessDocumentsClient([ACCESS_OFFICER]), data.documentId),
  );
  vi.mocked(markSelfAccessDelivered).mockImplementation(({ data }) =>
    markDelivered(officer(), data.applicationId, data.idempotencyKey),
  );
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ApplicationDetailView (slice #302)', () => {
  it("shows a representative's application with the identity check and both proofs", async () => {
    renderDetail(await applicationOf(A.ready));
    const application = screen.getByRole('region', { name: 'Application' });
    expect(within(application).getByText('Paul Oduor Otieno')).toBeTruthy();
    expect(within(application).getByText('Representative · ID 28817364')).toBeTruthy();
    expect(within(application).getByText('Collect at PSC')).toBeTruthy();
    expect(within(application).getByText('authority-letter-margaret-odhiambo.pdf')).toBeTruthy();
    expect(within(application).getByText('paul-otieno-national-id.jpg')).toBeTruthy();
  });

  it('keeps looking while the copy is prepared, with the 14-day deadline running', async () => {
    vi.useFakeTimers();
    renderDetail(await applicationOf(A.preparing));
    expect(within(copyCard()).getByText('Preparing the certified copy.')).toBeTruthy();
    expect(screen.getByText('14 days left')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(invalidate).toHaveBeenCalledOnce();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(
      within(copyCard()).getByText(
        'This is taking longer than usual. The page updates when the copy is ready.',
      ),
    ).toBeTruthy();
  });

  it('stops looking after two minutes, and checks again when asked', async () => {
    vi.useFakeTimers();
    renderDetail(await applicationOf(A.preparing));
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(invalidate).toHaveBeenCalledTimes(60);
    expect(
      within(copyCard()).getByText(
        'This is taking longer than usual. Check again in a few minutes.',
      ),
    ).toBeTruthy();
    fireEvent.click(within(copyCard()).getByRole('button', { name: 'Check again' }));
    expect(invalidate).toHaveBeenCalledTimes(61);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(invalidate).toHaveBeenCalledTimes(62);
  });

  it('says a failed copy was not issued, and that it is late', async () => {
    renderDetail(await applicationOf(A.failed));
    expect(
      within(copyCard()).getByText('Could not issue the copy. Nothing was issued.'),
    ).toBeTruthy();
    expect(screen.getByText('4 days late')).toBeTruthy();
  });

  it('opens the copy for the officer who recorded it and marks it collected after confirming', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({
      opener: window,
      location: { href: '' },
      close: vi.fn(),
    } as unknown as Window);
    renderDetail(await applicationOf(A.ready));

    fireEvent.click(within(copyCard()).getByRole('button', { name: 'Download to print' }));
    await waitFor(() => {
      expect(getCertifiedCopyLink).toHaveBeenCalledOnce();
    });
    const tab = open.mock.results[0]?.value as { location: { href: string }; opener: unknown };
    await waitFor(() => {
      expect(tab.location.href).toContain('/api/mock-files/');
    });
    expect(tab.opener).toBeNull();

    fireEvent.click(within(copyCard()).getByRole('button', { name: 'Mark collected' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark the copy collected?' });
    expect(within(dialog).getByText(/Paul Oduor Otieno collected the printed/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark collected' }));
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    expect((await applicationOf(A.ready)).status).toBe('delivered');
    open.mockRestore();
  });

  it('tells another officer only the recording officer can print it', async () => {
    renderDetail(await applicationOf(A.colleague));
    expect(
      within(copyCard()).getByText(
        'Only Grace Atieno, who recorded the application, can download the copy to hand it over.',
      ),
    ).toBeTruthy();
    expect(within(copyCard()).queryByRole('button', { name: 'Download to print' })).toBeNull();
    expect(within(copyCard()).getByRole('button', { name: 'Mark collected' })).toBeTruthy();
  });

  it('shows the supervisor where the copy stands, with nothing to do', async () => {
    renderDetail(await applicationOf(A.ready, mockAccessClient([SUPERVISOR])), true);
    expect(screen.getByText('Read only')).toBeTruthy();
    expect(within(copyCard()).queryByRole('button')).toBeNull();
    expect(
      within(copyCard()).getByText('The access officer hands over the copy and marks it.'),
    ).toBeTruthy();
  });

  it('shows when a dispatched copy was sent', async () => {
    renderDetail(await applicationOf(A.dispatched));
    expect(within(copyCard()).getByText('Dispatched')).toBeTruthy();
    expect(within(copyCard()).queryByRole('button', { name: /Mark/ })).toBeNull();
  });
});
