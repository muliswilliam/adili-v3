// @vitest-environment jsdom
import { ACCESS_OFFICER } from '@adili/roles';
import { addDays, formatDate, ToastProvider, TooltipProvider } from '@adili/ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  findRosterCandidates,
  getRepresentationAttachmentLink,
  resolveRequestedOfficer,
  verifyApplicantIdentity,
} from '../../server/access-requests';
import { loadRequest, resolveOfficer, searchRoster } from '../../server/access-requests.server';
import {
  MOCK_REQUEST_IDS as R,
  mockAccessClient,
  resetAccessMock,
  setAccessMockLatency,
} from '../../server/access/mock.server';
import type { OfficerRequestView } from '../../server/access/types';
import { RequestDetailView } from './request-detail';

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
    children: React.ReactNode;
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
vi.mock('../../server/access-requests', () => ({
  findRosterCandidates: vi.fn(),
  resolveRequestedOfficer: vi.fn(),
  verifyApplicantIdentity: vi.fn(),
  getRepresentationAttachmentLink: vi.fn(),
}));

const client = () => mockAccessClient([ACCESS_OFFICER]);
const NOW = new Date().toISOString();

async function viewOf(id: string): Promise<OfficerRequestView> {
  const result = await loadRequest(client(), id);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

function renderDetail(view: OfficerRequestView, readOnly = false) {
  render(
    <TooltipProvider>
      <ToastProvider>
        <RequestDetailView view={view} readOnly={readOnly} now={NOW} />
      </ToastProvider>
    </TooltipProvider>,
  );
}

function formOf(element: HTMLElement): HTMLFormElement {
  const form = element.closest('form');
  if (!form) throw new Error('No form');
  return form;
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
  // The server functions, answered by the mock as the access officer.
  vi.mocked(findRosterCandidates).mockImplementation(({ data }) =>
    searchRoster(client(), data.requestId, data.q),
  );
  vi.mocked(resolveRequestedOfficer).mockImplementation(({ data }) =>
    resolveOfficer(client(), data.requestId, data.rosterRecordId, data.idempotencyKey),
  );
});

describe('RequestDetailView (spec 10 FE-5)', () => {
  it('renders Form K by part, with how the applicant was identified', async () => {
    renderDetail(await viewOf(R.objection));
    const form = screen.getByRole('region', { name: 'Form K' });
    for (const part of [
      'Part I · Applicant',
      'Part II · Officer sought',
      'Part III · Information sought',
      'Scope requested',
      'Part IV · Declaration',
    ]) {
      expect(within(form).getByRole('region', { name: part })).toBeTruthy();
    }
    expect(within(form).getByText('IPRS match')).toBeTruthy();
    expect(within(form).getByText('Officer, spouses and children')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Access register' })).toBeTruthy();
  });

  it('S3: searches the roster by name or file number and identifies the officer, notifying the declarant', async () => {
    const view = await viewOf(R.identify);
    renderDetail(view);
    const card = within(side()).getByRole('region', { name: 'Identify officer' });
    fireEvent.change(within(card).getByRole('searchbox', { name: /Search the roster/ }), {
      target: { value: 'Ouma' },
    });
    fireEvent.submit(formOf(within(card).getByRole('searchbox')));
    const results = await within(card).findByRole('list', { name: 'Roster records' });
    // A record that has not onboarded cannot be chosen: no declarant to notify.
    const adhiambo = within(results).getByText('Josephine Adhiambo Ouma').closest('li');
    expect(adhiambo?.textContent).toContain('Not onboarded');
    expect(within(adhiambo as HTMLElement).queryByRole('button')).toBeNull();

    fireEvent.click(within(results).getByRole('button', { name: 'Select Josephine Akinyi Ouma' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Identify as Josephine Akinyi Ouma?',
    });
    expect(dialog.textContent).toContain('The declarant is notified');
    expect(dialog.textContent).toContain(
      "7 days under the Commission's policy, or earlier if they consent.",
    );
    expect(dialog.textContent).toContain('This cannot be changed');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Identify and notify' }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    expect(vi.mocked(resolveRequestedOfficer)).toHaveBeenCalledWith({
      data: {
        requestId: R.identify,
        rosterRecordId: 'a11d0000-0000-4000-8000-000000000001',
        idempotencyKey: expect.any(String) as unknown,
      },
    });
    expect(await screen.findByText(/identified\. The declarant is being notified/)).toBeTruthy();
  });

  it("the identify dialog closes the window by the Commission's policy; without it, no date", async () => {
    const view = await viewOf(R.identify);
    renderDetail({ ...view, representationWindowDays: 10 });
    const pick = async () => {
      const card = within(side()).getByRole('region', { name: 'Identify officer' });
      fireEvent.change(within(card).getByRole('searchbox', { name: /Search the roster/ }), {
        target: { value: 'Ouma' },
      });
      fireEvent.submit(formOf(within(card).getByRole('searchbox')));
      const results = await within(card).findByRole('list', { name: 'Roster records' });
      fireEvent.click(
        within(results).getByRole('button', { name: 'Select Josephine Akinyi Ouma' }),
      );
      return screen.findByRole('dialog', { name: 'Identify as Josephine Akinyi Ouma?' });
    };
    const dialog = await pick();
    expect(dialog.textContent).toContain(
      "10 days under the Commission's policy, or earlier if they consent.",
    );
    expect(dialog.textContent).toContain(`Representations close ${formatDate(addDays(NOW, 10))}`);
    cleanup();

    renderDetail({ ...view, representationWindowDays: null });
    const unknown = await pick();
    expect(unknown.textContent).toContain('Their window for representations opens');
    expect(unknown.textContent).not.toContain('Representations close');
  });

  it('says when no roster record matches', async () => {
    renderDetail(await viewOf(R.identify));
    const search = within(side()).getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'Mrs Kamau Ardhi' } });
    fireEvent.submit(formOf(search));
    expect(await within(side()).findByText(/No roster record matches/)).toBeTruthy();
  });

  it('S3: records that the officer cannot be identified, after confirming', async () => {
    renderDetail(await viewOf(R.unresolved));
    fireEvent.click(within(side()).getByRole('button', { name: 'Cannot identify' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cannot identify the officer?' });
    expect(dialog.textContent).toContain('Counted as declined in Form M');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close request' }));
    await waitFor(() => {
      expect(vi.mocked(resolveRequestedOfficer)).toHaveBeenCalledWith({
        data: expect.objectContaining({ rosterRecordId: null }) as unknown,
      });
    });
    expect(await screen.findByText('Request closed. The applicant has been told.')).toBeTruthy();
  });

  it('keeps the dialog open with the reason when the record cannot be notified', async () => {
    vi.mocked(resolveRequestedOfficer).mockResolvedValueOnce({
      ok: false,
      error: {
        kind: 'problem',
        problem: {
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          errors: [{ path: 'rosterRecordId', message: 'not onboarded' }],
        },
      },
    });
    renderDetail(await viewOf(R.identify));
    const search = within(side()).getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'Peter' } });
    fireEvent.submit(formOf(search));
    fireEvent.click(await screen.findByRole('button', { name: 'Select Peter Omondi Ouma' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Identify and notify' }));
    expect(await within(dialog).findByText(/has not onboarded/)).toBeTruthy();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('verifies a passport applicant: the check and a note are required', async () => {
    vi.mocked(verifyApplicantIdentity).mockImplementation(() =>
      loadRequest(client(), R.verify).then((result) =>
        result.ok ? { ok: true, data: { ...result.data, status: 'submitted' as const } } : result,
      ),
    );
    renderDetail(await viewOf(R.verify));
    const card = within(side()).getByRole('region', { name: 'Verify applicant identity' });
    expect(card.textContent).toContain('G2837465 · GH');
    fireEvent.click(within(card).getByRole('button', { name: 'Record verification' }));
    expect(
      within(card).getByText('Confirm you checked the particulars against the passport.'),
    ).toBeTruthy();
    expect(within(card).getByText('Say how you checked the particulars.')).toBeTruthy();
    expect(vi.mocked(verifyApplicantIdentity)).not.toHaveBeenCalled();

    fireEvent.click(within(card).getByRole('checkbox'));
    fireEvent.change(within(card).getByRole('textbox'), {
      target: { value: 'Passport copy seen by email.' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Record verification' }));
    await waitFor(() => {
      expect(vi.mocked(verifyApplicantIdentity)).toHaveBeenCalledWith({
        data: {
          requestId: R.verify,
          note: 'Passport copy seen by email.',
          idempotencyKey: expect.any(String) as unknown,
        },
      });
    });
    expect(await screen.findByText('Applicant verified. Identify the officer next.')).toBeTruthy();
  });

  it('shows the representations: stance, text and attachments, each downloadable', async () => {
    vi.mocked(getRepresentationAttachmentLink).mockResolvedValue({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    });
    renderDetail(await viewOf(R.objection));
    const card = within(side()).getByRole('region', { name: 'Representations' });
    expect(within(card).getByText('Object')).toBeTruthy();
    expect(card.textContent).toContain('Edited');
    const files = within(card).getByRole('list', { name: 'Attachments' });
    expect(within(files).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.keyDown(
      within(files).getByRole('button', {
        name: 'Actions for Declaration of interest to tender committee.pdf',
      }),
      { key: 'Enter' },
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Download' }));
    expect(await screen.findByText('The attachment could not be opened. Try again.')).toBeTruthy();
  });

  it('says when nothing came in the window, and when consent closed it early', async () => {
    renderDetail(await viewOf(R.noReply));
    expect(within(side()).getByText(/None received\. The window closed/)).toBeTruthy();
  });

  it('S16: the supervisor reads everything but takes no step', async () => {
    renderDetail(await viewOf(R.unresolved), true);
    expect(screen.getByText('Read only')).toBeTruthy();
    expect(
      within(side()).getByText('Waiting for the access officer to identify the officer.'),
    ).toBeTruthy();
    expect(within(side()).queryByRole('searchbox')).toBeNull();
    expect(within(side()).queryByRole('button')).toBeNull();
  });

  it('S16: the supervisor reads the representations; only the access officer decides', async () => {
    renderDetail(await viewOf(R.objection), true);
    expect(within(side()).getByText('Only the access officer decides.')).toBeTruthy();
    expect(within(side()).getByRole('region', { name: 'Representations' })).toBeTruthy();
  });

  it('#260: under decision, the access officer opens the decision form; in the window it is locked', async () => {
    renderDetail(await viewOf(R.objection));
    expect(within(side()).getByRole('link', { name: 'Decide' }).getAttribute('href')).toBe(
      `/access/requests/${R.objection}/decide`,
    );
    cleanup();
    renderDetail(await viewOf(R.window));
    const decide = within(side()).getByRole('button', { name: 'Decide' });
    expect((decide as HTMLButtonElement).disabled).toBe(true);
  });

  it('#260: the supervisor gets no Decide', async () => {
    renderDetail(await viewOf(R.objection), true);
    expect(within(side()).queryByRole('link', { name: 'Decide' })).toBeNull();
    expect(within(side()).queryByRole('button', { name: 'Decide' })).toBeNull();
  });

  it('#260: a partial grant shows its scope, grounds and reasons, and the package with its downloads', async () => {
    renderDetail(await viewOf(R.partial));
    const decision = within(side()).getByRole('region', { name: 'Decision' });
    expect(within(decision).getByText('Partially granted')).toBeTruthy();
    expect(
      within(decision).getByText(
        '2026 · Officer and spouses · Assets, liabilities, clarifications',
      ),
    ).toBeTruthy();
    expect(within(decision).getByText('Against public interest')).toBeTruthy();
    const pkg = within(side()).getByRole('region', { name: 'Package' });
    expect(within(pkg).getByText('Confidential')).toBeTruthy();
    expect(within(pkg).getByText('Download until')).toBeTruthy();
    expect(within(pkg).getByText('2')).toBeTruthy();
    expect(within(pkg).getByText(/· last /)).toBeTruthy();
    expect(within(pkg).getByText(/Mercy Wanjiku Kamau ·/)).toBeTruthy();
    expect(within(pkg).getByText('Only Mercy Wanjiku Kamau can download it.')).toBeTruthy();
  });

  it('#260: a package past its window says so; one not issued yet is preparing; a denial has none', async () => {
    renderDetail(await viewOf(R.expired));
    let pkg = within(side()).getByRole('region', { name: 'Package' });
    expect(within(pkg).getByText('Window closed')).toBeTruthy();
    expect(within(pkg).getByText('Closed')).toBeTruthy();
    cleanup();

    renderDetail(await viewOf(R.preparing));
    pkg = within(side()).getByRole('region', { name: 'Package' });
    expect(within(pkg).getByRole('status').textContent).toContain('Preparing');
    cleanup();

    renderDetail(await viewOf(R.denied));
    expect(within(side()).queryByRole('region', { name: 'Package' })).toBeNull();
    const decision = within(side()).getByRole('region', { name: 'Decision' });
    expect(within(decision).getByText('Frivolous, vexatious or scandalous')).toBeTruthy();
    expect(within(decision).getByText('Does not promote the objectives of the Act')).toBeTruthy();
  });

  it('a grant with no package an hour on says none was issued, as every audience reads it', async () => {
    renderDetail(await viewOf(R.noPackage));
    const pkg = within(side()).getByRole('region', { name: 'Package' });
    expect(pkg.textContent).toContain('No package has been issued for this grant.');
    expect(within(pkg).queryByRole('status')).toBeNull();
  });

  it('a package still preparing an hour after the grant turns into none issued, by itself', async () => {
    const view = await viewOf(R.preparing);
    vi.useFakeTimers();
    try {
      renderDetail(view);
      let pkg = within(side()).getByRole('region', { name: 'Package' });
      expect(within(pkg).getByRole('status').textContent).toContain('Preparing');
      act(() => {
        vi.advanceTimersByTime(61 * 60_000);
      });
      pkg = within(side()).getByRole('region', { name: 'Package' });
      expect(pkg.textContent).toContain('No package has been issued for this grant.');
      // The page stopped looking for it: twenty polls while preparing, none after.
      const polls = invalidate.mock.calls.length;
      act(() => {
        vi.advanceTimersByTime(10 * 60_000);
      });
      expect(invalidate.mock.calls.length).toBe(polls);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closed requests say how they closed', async () => {
    renderDetail(await viewOf(R.cannot));
    expect(within(side()).getByText('Cannot identify officer')).toBeTruthy();
    expect(within(side()).getByText(/Applicant notified\./)).toBeTruthy();
  });
});
