// @vitest-environment jsdom
import { ACCESS_OFFICER } from '@adili/roles';
import { addDays, formatDate, ToastProvider, TooltipProvider } from '@adili/ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enterWrittenRepresentations,
  findRosterCandidates,
  getRepresentationAttachmentLink,
  recordAccessWrittenNotice,
  resolveRequestedOfficer,
  verifyApplicantIdentity,
} from '../../server/access-requests';
import {
  enterRepresentations,
  loadRequest,
  recordWrittenNotice,
  resolveOfficer,
  searchRoster,
} from '../../server/access-requests.server';
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
  recordAccessWrittenNotice: vi.fn(),
  enterWrittenRepresentations: vi.fn(),
  createRepresentationScanUpload: vi.fn(),
  completeRepresentationScan: vi.fn(),
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
  vi.mocked(recordAccessWrittenNotice).mockImplementation(({ data }) =>
    recordWrittenNotice(client(), data.requestId, data.notifiedOn, data.idempotencyKey),
  );
  vi.mocked(enterWrittenRepresentations).mockImplementation(({ data }) =>
    enterRepresentations(client(), data.requestId, data.input, data.idempotencyKey),
  );
});

/** Today in Nairobi, `YYYY-MM-DD`, and as the date field takes it. */
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
const typed = (iso: string) => iso.split('-').reverse().join('/');
const dayBefore = (iso: string) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

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
    // A record that has not onboarded is marked; it can be chosen, to be served in writing.
    const adhiambo = within(results).getByText('Josephine Adhiambo Ouma').closest('li');
    expect(adhiambo?.textContent).toContain('Not onboarded');
    expect(adhiambo?.textContent).toContain('you serve the notice in writing');

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

  it('decision 2: identifying an officer with no account says they are invited and served in writing', async () => {
    renderDetail(await viewOf(R.identify));
    const search = within(side()).getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'Adhiambo' } });
    fireEvent.submit(formOf(search));
    fireEvent.click(await screen.findByRole('button', { name: 'Select Josephine Adhiambo Ouma' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Identify as Josephine Adhiambo Ouma?',
    });
    expect(dialog.textContent).toContain('They are invited to onboard');
    expect(dialog.textContent).toContain('You serve the notice in writing');
    expect(dialog.textContent).not.toContain('The declarant is notified');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Identify' }));
    expect(
      await screen.findByText(
        'Josephine Adhiambo Ouma identified. Serve the notice in writing next.',
      ),
    ).toBeTruthy();
  });

  it('decision 2: records the day the written notice was served, within its bounds', async () => {
    renderDetail(await viewOf(R.noAccount));
    const card = within(side()).getByRole('region', { name: 'Notify in writing' });
    expect(card.textContent).toContain('Samuel Kiprotich Rotich has no Adili account');
    expect(card.textContent).toMatch(/Invited to onboard on /);
    const officer = within(side()).getByRole('region', { name: 'Officer identified' });
    expect(within(officer).getByText('Declarant')).toBeTruthy();
    expect(officer.textContent).toContain('Not onboarded');
    expect(officer.textContent).toContain('Awaiting written notice');
    // No "Notifying the declarant" spinner: nothing polls.
    expect(within(side()).queryByText(/Notifying the declarant/)).toBeNull();

    const field = within(card).getByRole('textbox', { name: /Day the notice was served/ });
    fireEvent.click(within(card).getByRole('button', { name: 'Record written notice' }));
    expect(within(card).getByText('Enter the day the notice was served.')).toBeTruthy();
    fireEvent.change(field, { target: { value: '01/01/2099' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Record written notice' }));
    expect(within(card).getByText('The day cannot be in the future.')).toBeTruthy();
    fireEvent.change(field, { target: { value: '01/01/2020' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Record written notice' }));
    expect(
      within(card).getByText(/cannot be before .*when the officer was identified/),
    ).toBeTruthy();
    expect(vi.mocked(recordAccessWrittenNotice)).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: typed(TODAY) } });
    expect(within(card).getByText(/Representations will close at the end of /)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Record written notice' }));
    await waitFor(() => {
      expect(vi.mocked(recordAccessWrittenNotice)).toHaveBeenCalledWith({
        data: {
          requestId: R.noAccount,
          notifiedOn: TODAY,
          idempotencyKey: expect.any(String) as unknown,
        },
      });
    });
    expect(
      await screen.findByText('Written notice recorded. The window for representations is open.'),
    ).toBeTruthy();
  });

  it('decision 2: a retry keeps its Idempotency-Key, a corrected day gets a new one', async () => {
    renderDetail(await viewOf(R.noAccount));
    const card = within(side()).getByRole('region', { name: 'Notify in writing' });
    const field = within(card).getByRole('textbox', { name: /Day the notice was served/ });
    const submit = () =>
      fireEvent.click(within(card).getByRole('button', { name: 'Record written notice' }));
    vi.mocked(recordAccessWrittenNotice)
      .mockResolvedValueOnce({ ok: false, error: { kind: 'unavailable', detail: null } })
      .mockResolvedValueOnce({
        ok: false,
        error: {
          kind: 'problem',
          problem: {
            type: 'about:blank',
            title: 'Bad Request',
            status: 400,
            errors: [{ path: 'notifiedOn', message: 'after the Nairobi day' }],
          },
        },
      });
    const keys = () =>
      vi.mocked(recordAccessWrittenNotice).mock.calls.map(([call]) => call.data.idempotencyKey);

    fireEvent.change(field, { target: { value: typed(TODAY) } });
    submit();
    await waitFor(() => {
      expect(keys()).toHaveLength(1);
    });
    // Tried again as it was: the same key, so the service answers once.
    submit();
    await waitFor(() => {
      expect(keys()).toHaveLength(2);
    });
    expect(keys()[1]).toBe(keys()[0]);
    // Refused at the day: the service keeps that answer under the key, so the corrected day
    // goes with a new one.
    const yesterday = dayBefore(TODAY);
    fireEvent.change(field, { target: { value: typed(yesterday) } });
    submit();
    await waitFor(() => {
      expect(keys()).toHaveLength(3);
    });
    expect(keys()[2]).not.toBe(keys()[1]);
    expect(vi.mocked(recordAccessWrittenNotice).mock.calls[2]?.[0].data.notifiedOn).toBe(yesterday);
  });

  it('decision 2: the supervisor waits for the written notice and takes no step', async () => {
    renderDetail(await viewOf(R.noAccount), true);
    expect(
      within(side()).getByText('Waiting for the access officer to record the written notice.'),
    ).toBeTruthy();
    expect(within(side()).queryByRole('button')).toBeNull();
  });

  it('decision 2: notified in writing, with the representations received in writing', async () => {
    renderDetail(await viewOf(R.writtenNotice));
    const officer = within(side()).getByRole('region', { name: 'Officer identified' });
    expect(officer.textContent).toMatch(/In writing, served /);
    expect(officer.textContent).toMatch(/Recorded by Lucy Wambui/);
    const reps = within(side()).getByRole('region', { name: 'Representations' });
    expect(within(reps).getByText('Received in writing')).toBeTruthy();
    expect(within(reps).getByText(/^Entered by Lucy Wambui · /)).toBeTruthy();
    const register = screen.getByRole('list', { name: 'Access register' });
    expect(within(register).getByText('Declarant notified in writing')).toBeTruthy();
    expect(within(register).getByText('Representations received in writing')).toBeTruthy();

    fireEvent.click(within(reps).getByRole('button', { name: 'Update from a new letter' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Representations received in writing',
    });
    expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: /Object/ }).checked).toBe(
      true,
    );
    fireEvent.click(within(dialog).getByRole('radio', { name: /Add context/ }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Representations/ }), {
      target: { value: '' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save representations' }));
    expect(within(dialog).getByText('Enter the representations, or choose Consent.')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Representations/ }), {
      target: { value: 'A second letter adds context.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save representations' }));
    await waitFor(() => {
      expect(vi.mocked(enterWrittenRepresentations)).toHaveBeenCalledWith({
        data: {
          requestId: R.writtenNotice,
          input: {
            stance: 'context',
            text: 'A second letter adds context.',
            attachments: ['a11e0000-0000-4000-8000-000000000031'],
          },
          idempotencyKey: expect.any(String) as unknown,
        },
      });
    });
    expect(await screen.findByText('Representations saved as received in writing.')).toBeTruthy();
  });

  it('decision 2: the supervisor reads representations received in writing but enters none', async () => {
    renderDetail(await viewOf(R.writtenNotice), true);
    const reps = within(side()).getByRole('region', { name: 'Representations' });
    expect(within(reps).getByText('Received in writing')).toBeTruthy();
    expect(within(reps).queryByRole('button', { name: /letter|received in writing/ })).toBeNull();
  });

  it("keeps the dialog open with the reason when the record is not the Commission's", async () => {
    vi.mocked(resolveRequestedOfficer).mockResolvedValueOnce({
      ok: false,
      error: {
        kind: 'problem',
        problem: {
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          errors: [{ path: 'rosterRecordId', message: 'is not a roster record' }],
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
    expect(await within(dialog).findByText(/not on the Commission's roster/)).toBeTruthy();
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

  it('decision 1: a grant whose scope held nothing shows the nil letter, issued like a package', async () => {
    renderDetail(await viewOf(R.nilLetter));
    const letter = within(side()).getByRole('region', { name: 'Nil letter' });
    expect(letter.textContent).toContain('No declarations held within the granted scope.');
    expect(letter.textContent).toContain('signed letter instead of a package');
    expect(within(letter).getByText('Downloads')).toBeTruthy();
    expect(within(letter).getByText('Watermark')).toBeTruthy();
    expect(within(side()).queryByRole('region', { name: 'Package' })).toBeNull();
  });

  it('a package whose issuing failed says so, apart from one being prepared', async () => {
    renderDetail(await viewOf(R.failed));
    const pkg = within(side()).getByRole('region', { name: 'Package' });
    expect(within(pkg).getByRole('alert').textContent).toContain(
      'The package could not be issued.',
    );
    expect(pkg.textContent).toContain('The decision stands.');
    expect(within(pkg).queryByRole('status')).toBeNull();
  });

  it('a package being prepared is polled for, and does not turn into anything else by itself', async () => {
    const view = await viewOf(R.preparing);
    vi.useFakeTimers();
    try {
      renderDetail(view);
      const pkg = within(side()).getByRole('region', { name: 'Package' });
      expect(within(pkg).getByRole('status').textContent).toContain('Preparing');
      act(() => {
        vi.advanceTimersByTime(61 * 60_000);
      });
      expect(
        within(within(side()).getByRole('region', { name: 'Package' })).getByRole('status')
          .textContent,
      ).toContain('Preparing');
      // Twenty polls while preparing, then the page stops looking.
      expect(invalidate.mock.calls.length).toBe(20);
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
