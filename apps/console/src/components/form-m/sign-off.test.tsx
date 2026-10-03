// @vitest-environment jsdom
import { COMMISSION_ADMIN, REPORTING_OFFICER, SUPERVISOR } from '@adili/roles';
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type FormMResult,
  type FormMWorkspace,
  loadReport,
  loadWorkspace,
} from '../../server/form-m.server';
import {
  confirmReport,
  type ConfirmOutcome,
  documentLink,
  markReviewed,
  saveManualFields,
  saveRemarks,
} from '../../server/form-m-sign-off.server';
import {
  failNextReportingConfirms,
  mockReportingClient,
  mockReportingDocumentsClient,
  type ReportingMockSeed,
  resetReportingMock,
  setReportingMockLatency,
} from '../../server/reporting/mock.server';
import { formMCapabilities } from '../workspaces';
import type { StepUpMarker } from './confirm';
import { FormMSignOffView, type SignOffActions, type SignOffNavigation } from './sign-off';

const invalidate = vi.fn(() => Promise.resolve());
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }));

beforeAll(() => {
  setReportingMockLatency(0);
});
afterAll(() => {
  setReportingMockLatency(1);
});
beforeEach(() => {
  invalidate.mockClear();
});

const NAMES: Record<string, string> = {
  [SUPERVISOR]: 'Samuel Njoroge',
  [COMMISSION_ADMIN]: 'Joyce Wanjiku',
  [REPORTING_OFFICER]: 'Grace Muthoni',
};

/** The sign-off's calls against the reporting mock, as `role`, with a fresh step-up. */
function mockActions(role: string, overrides: Partial<SignOffActions> = {}): SignOffActions {
  const client = mockReportingClient([role], { name: NAMES[role] });
  return {
    saveRemarks: (fy, remarks) => saveRemarks(client, 'psc', fy, remarks),
    saveManualFields: (fy, fields) => saveManualFields(client, 'psc', fy, fields),
    markReviewed: (fy, designation) => markReviewed(client, 'psc', fy, designation),
    confirm: (fy, key) =>
      confirmReport(
        mockReportingClient([role], { name: NAMES[role], stepUpAt: Date.now() }),
        'psc',
        fy,
        key,
      ),
    stepUpFresh: () => Promise.resolve(true),
    documentLink: (id) => documentLink(mockReportingDocumentsClient([role]), id),
    ...overrides,
  };
}

function navigation() {
  return {
    stepUp: vi.fn<SignOffNavigation['stepUp']>(),
    signIn: vi.fn<SignOffNavigation['signIn']>(),
    download: vi.fn<SignOffNavigation['download']>(),
    clearStepUpMarker: vi.fn<SignOffNavigation['clearStepUpMarker']>(),
  };
}

async function load(today: string, role: string): Promise<FormMResult<FormMWorkspace>> {
  return loadWorkspace(mockReportingClient([role]), 'psc', { fy: 2025, today });
}

/** Seeds the mock on `today`, loads FY 2025 as `role` and renders the sign-off view. */
async function show(
  role: string,
  {
    today = '2026-10-03',
    seed = {},
    marker = null,
    actions,
  }: {
    today?: string;
    seed?: ReportingMockSeed;
    marker?: StepUpMarker | null;
    actions?: SignOffActions;
  } = {},
) {
  resetReportingMock(today, seed);
  const nav = navigation();
  const element = async () => (
    <ToastProvider>
      <TooltipProvider>
        <FormMSignOffView
          result={await load(today, role)}
          capabilities={formMCapabilities([role])}
          viewerName={NAMES[role] ?? ''}
          stepUpMarker={marker}
          actions={actions ?? mockActions(role)}
          navigation={nav}
          onSelect={vi.fn()}
          onCompile={vi.fn(() => Promise.resolve({ ok: true, data: null } as const))}
        />
      </TooltipProvider>
    </ToastProvider>
  );
  const view = render(await element());
  return {
    nav,
    /** Renders again from the mock as it now stands, as `router.invalidate` would. */
    reload: async () => {
      view.rerender(await element());
    },
  };
}

const footer = () => screen.getByText(/^Due 31 July 2026/).closest('div') as HTMLElement;
const confirmButton = () => within(footer()).getByRole('button', { name: 'Confirm and submit' });

/** The banner whose text includes `text`. */
async function alertWith(text: string): Promise<HTMLElement> {
  const banner = (await screen.findByText(text)).closest<HTMLElement>('[role="alert"]');
  if (!banner) throw new Error(`No alert says ${text}`);
  return banner;
}

async function report() {
  const result = await loadReport(mockReportingClient([SUPERVISOR]), 'psc', 2025);
  if (!result.ok) throw new Error('not ok');
  return result.data;
}

describe('the supervisor reviews the draft (S3, S5)', () => {
  it('edits a remark, saved by obligation id when the field is left', async () => {
    await show(SUPERVISOR);
    const field = screen.getByRole('textbox', {
      name: 'Remarks for Peter Mwangi Githinji (PSC/2011/0217)',
    });
    fireEvent.change(field, { target: { value: 'Salary stopped; officer on sick leave' } });
    expect((field as HTMLTextAreaElement).value).toBe('Salary stopped; officer on sick leave');
    fireEvent.blur(field);
    const section = screen.getByRole('region', {
      name: /Submission of biennial declaration/,
    });
    await within(section).findByText('Remarks saved');
    expect(screen.getAllByText('Remarks saved')).toHaveLength(1);
    expect((await report()).document?.partII.biennial.nonFilers[0]?.remarks).toBe(
      'Salary stopped; officer on sick leave',
    );
  });

  it('marks the draft reviewed with a designation, recorded in Part III', async () => {
    await show(SUPERVISOR);
    fireEvent.click(within(footer()).getByRole('button', { name: 'Mark reviewed' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark Form M reviewed' });
    expect(within(dialog).getByLabelText('Name')).toHaveProperty('value', 'Samuel Njoroge');
    expect(within(dialog).getByLabelText('Date')).toHaveProperty('value', '3 Oct 2026');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark reviewed' }));
    expect(within(dialog).getByText('Enter your designation')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Designation'), {
      target: { value: 'Deputy Director, HRM' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark reviewed' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(invalidate).toHaveBeenCalled();
    expect((await report()).document?.partIII.compiledBy).toMatchObject({
      name: 'Samuel Njoroge',
      designation: 'Deputy Director, HRM',
    });
  });

  it('waits for the commission-admin once reviewed', async () => {
    await show(SUPERVISOR, { seed: { reviewed: true } });
    expect(
      within(footer()).getByText('Awaiting confirmation by the commission administrator'),
    ).toBeTruthy();
    expect(within(footer()).queryByRole('button')).toBeNull();
  });
});

describe('the commission-admin fills Part I and Part B (S5)', () => {
  it('waits for the supervisor while the draft is not reviewed', async () => {
    await show(COMMISSION_ADMIN);
    expect(within(footer()).getByText('Awaiting supervisor review')).toBeTruthy();
    expect(confirmButton()).toHaveProperty('disabled', true);
    expect(screen.getAllByText('You fill this')).toHaveLength(2);
  });

  it('enables Confirm and submit once reviewed and Part I and Part B are filled', async () => {
    await show(COMMISSION_ADMIN, { seed: { reviewed: true } });
    expect(
      within(footer()).getByText(
        'Fill Part I: contact details, email address · Answer question 6 in Part B',
      ),
    ).toBeTruthy();
    expect(confirmButton()).toHaveProperty('disabled', true);

    const contact = screen.getByLabelText('(ii) Contact details');
    fireEvent.change(contact, { target: { value: '+254 20 222 3901' } });
    fireEvent.blur(contact);
    const email = screen.getByLabelText('(iv) Email address');
    fireEvent.change(email, { target: { value: 'compliance@publicservice' } });
    fireEvent.blur(email);
    expect(screen.getByText('Enter a valid email address')).toBeTruthy();
    fireEvent.change(email, { target: { value: 'compliance@publicservice.go.ke' } });
    fireEvent.blur(email);
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    await waitFor(() => {
      expect(confirmButton()).toHaveProperty('disabled', false);
    });
    const { document } = await report();
    expect(document?.partI).toMatchObject({
      contactDetails: '+254 20 222 3901',
      emailAddress: 'compliance@publicservice.go.ke',
    });
    expect(document?.partII.complaints.registerMaintained).toBe(true);
  });

  it('adds, edits and removes complaints in Part B', async () => {
    await show(COMMISSION_ADMIN);
    fireEvent.click(screen.getByRole('button', { name: 'Add complaint' }));
    let dialog = screen.getByRole('dialog', { name: 'Add a complaint' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add complaint' }));
    expect(within(dialog).getByText('Enter the name')).toBeTruthy();
    const fill = (label: string, value: string) => {
      fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    };
    fill('Name', 'Jane Achieng');
    fill('Designation', 'Clerk');
    fill('Staff, file, ID or passport number', 'PSC/2020/0001');
    fill('Nature of complaint', 'Alleged undisclosed business interest');
    fill('Status', 'Under investigation');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add complaint' }));
    const table = await screen.findByRole('table', {
      name: 'Section 7: Complaints received and action taken',
    });
    expect(within(table).getByText('Jane Achieng')).toBeTruthy();

    fireEvent.click(within(table).getByRole('button', { name: 'Edit complaint 1' }));
    dialog = screen.getByRole('dialog', { name: 'Edit complaint' });
    fill('Status', 'Closed');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(within(table).getByText('Closed')).toBeTruthy();
    await waitFor(async () => {
      expect((await report()).document?.partII.complaints.items[0]?.status).toBe('Closed');
    });

    fireEvent.click(within(table).getByRole('button', { name: 'Remove complaint 1' }));
    expect(screen.getByText('No complaints recorded.')).toBeTruthy();
    await waitFor(async () => {
      expect((await report()).document?.partII.complaints.items).toHaveLength(0);
    });
  });

  it('shows the reporting officer every part read-only', async () => {
    await show(REPORTING_OFFICER, { seed: { reviewed: true } });
    expect(screen.queryByLabelText('(ii) Contact details')).toBeNull();
    expect(screen.queryByRole('textbox', { name: /Remarks for/ })).toBeNull();
    expect(within(footer()).getByText('Read only')).toBeTruthy();
    expect(within(footer()).queryByRole('button')).toBeNull();
  });
});

describe('confirming with a step-up (S6, S7)', () => {
  const ready = { reviewed: true, filled: true } as const;

  it('sends the commission-admin to confirm their identity first', async () => {
    const { nav } = await show(COMMISSION_ADMIN, { seed: ready });
    fireEvent.click(confirmButton());
    await waitFor(() => {
      expect(nav.stepUp).toHaveBeenCalledWith('/form-m?fy=2025');
    });
  });

  it('opens the confirm dialog on the way back, warns it is late, and submits', async () => {
    const { nav } = await show(COMMISSION_ADMIN, { seed: ready, marker: 'done' });
    expect(nav.clearStepUpMarker).toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Confirm and submit Form M' });
    expect(
      within(dialog).getByText(
        'Confirm and submit Form M for FY 2025/2026 to EACC? The report is frozen and receives its reference.',
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(
        'Part III records you, Joyce Wanjiku, as the officer who confirmed it, dated 3 Oct 2026.',
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByText('You and Samuel Njoroge are notified with the receipt.'),
    ).toBeTruthy();
    expect(within(dialog).getByText('Due 31 Jul 2026. It will be recorded as late.')).toBeTruthy();
    const submit = within(dialog).getByRole('button', { name: 'Confirm and submit' });
    expect(submit).toHaveProperty('disabled', true);
    fireEvent.click(within(dialog).getByLabelText('I confirm the information is correct'));
    fireEvent.click(submit);
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    expect(await report()).toMatchObject({
      status: 'submitted',
      late: true,
      reference: 'RPT-PSC-2026-0000001-K',
    });
  });

  it('has no late warning by 31 July', async () => {
    await show(COMMISSION_ADMIN, { today: '2026-07-28', seed: ready, marker: 'done' });
    const dialog = await screen.findByRole('dialog', { name: 'Confirm and submit Form M' });
    expect(within(dialog).queryByText(/recorded as late/)).toBeNull();
  });

  it('says the identity was not confirmed when the step-up failed, and offers it again', async () => {
    const { nav } = await show(COMMISSION_ADMIN, { seed: ready, marker: 'failed' });
    const banner = await alertWith('We could not confirm your identity. Try again.');
    expect(within(banner).getByText('Form M has not been submitted.')).toBeTruthy();
    fireEvent.click(within(banner).getByRole('button', { name: 'Confirm identity' }));
    await waitFor(() => {
      expect(nav.stepUp).toHaveBeenCalledWith('/form-m?fy=2025');
    });
  });

  it('says a failed step-up even when the report cannot be confirmed now', async () => {
    await show(COMMISSION_ADMIN, { seed: { reviewed: true }, marker: 'failed' });
    expect(await screen.findByText('We could not confirm your identity. Try again.')).toBeTruthy();
  });

  it('treats a step-up the session no longer holds as failed', async () => {
    await show(COMMISSION_ADMIN, {
      seed: ready,
      marker: 'done',
      actions: mockActions(COMMISSION_ADMIN, { stepUpFresh: () => Promise.resolve(false) }),
    });
    expect(await screen.findByText('We could not confirm your identity. Try again.')).toBeTruthy();
  });

  it('keeps the dialog open after a failure, and submits on Try again with the same key', async () => {
    const keys: string[] = [];
    const base = mockActions(COMMISSION_ADMIN);
    await show(COMMISSION_ADMIN, {
      seed: ready,
      marker: 'done',
      actions: {
        ...base,
        confirm: (fy, key) => {
          keys.push(key);
          return base.confirm(fy, key);
        },
      },
    });
    failNextReportingConfirms();
    const dialog = await screen.findByRole('dialog', { name: 'Confirm and submit Form M' });
    fireEvent.click(within(dialog).getByLabelText('I confirm the information is correct'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and submit' }));
    expect(
      await within(dialog).findByText(
        'Form M was not submitted. Try again. Nothing was sent twice.',
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect((await report()).status).toBe('submitted');
  });

  it.each<[ConfirmOutcome, string, string | null]>([
    [
      { status: 'already-submitted' },
      'This report was already submitted.',
      'Someone else confirmed it first.',
    ],
    [
      { status: 'incomplete', paths: ['partI.contactDetails', 'partI.emailAddress'] },
      'Form M is not complete.',
      'Fill contact details and email address in Part I.',
    ],
    [
      { status: 'forbidden' },
      'Form M was not submitted.',
      'Only the commission administrator of your Commission can confirm Form M.',
    ],
    [
      { status: 'not-reviewed' },
      'Form M was not submitted.',
      'The draft was recompiled since it was reviewed. Your supervisor must review it again.',
    ],
  ])('closes the dialog and says why after %o', async (answer, title, text) => {
    await show(COMMISSION_ADMIN, {
      seed: ready,
      marker: 'done',
      actions: mockActions(COMMISSION_ADMIN, { confirm: () => Promise.resolve(answer) }),
    });
    const dialog = await screen.findByRole('dialog', { name: 'Confirm and submit Form M' });
    fireEvent.click(within(dialog).getByLabelText('I confirm the information is correct'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and submit' }));
    const banner = await alertWith(title);
    if (text) expect(within(banner).getByText(text)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(invalidate).toHaveBeenCalled();
  });

  it('points to Part I when the report is incomplete', async () => {
    await show(COMMISSION_ADMIN, {
      seed: ready,
      marker: 'done',
      actions: mockActions(COMMISSION_ADMIN, {
        confirm: () => Promise.resolve({ status: 'incomplete', paths: ['partI.emailAddress'] }),
      }),
    });
    const dialog = await screen.findByRole('dialog', { name: 'Confirm and submit Form M' });
    fireEvent.click(within(dialog).getByLabelText('I confirm the information is correct'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and submit' }));
    const link = await screen.findByRole('link', { name: 'Go to Part I' });
    expect(link.getAttribute('href')).toBe('#form-m-part-i');
  });
});

describe('the submitted report (S6, S15)', () => {
  it('says the PDF and the receipt are being prepared, and reloads meanwhile', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await show(COMMISSION_ADMIN, { seed: { submitted: 'late', issuing: true } });
      const preparing = screen.getByRole('button', { name: 'Preparing Form M PDF…' });
      expect(preparing).toHaveProperty('disabled', true);
      expect(screen.getByRole('button', { name: 'Preparing receipt…' })).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(invalidate).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the reference, late badge and downloads, and downloads the receipt', async () => {
    const { nav } = await show(REPORTING_OFFICER, { seed: { submitted: 'late' } });
    expect(screen.getByRole('heading', { name: 'Submitted to EACC' })).toBeTruthy();
    expect(screen.getByText('Confirmed by Joyce Wanjiku, 26 Sep 2026, 14:42')).toBeTruthy();
    expect(screen.getByText('RPT-PSC-2026-0000001-K')).toBeTruthy();
    expect(screen.getByText('Late: due 31 Jul 2026')).toBeTruthy();
    expect(screen.getByText('Hosted on Adili')).toBeTruthy();
    expect(
      screen.getByText('Corrections are not possible yet. Contact EACC with the reference number.'),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Report as submitted' })).toBeTruthy();
    expect(screen.queryByText(/Due 31 July 2026/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Download receipt' }));
    await waitFor(() => {
      expect(nav.download).toHaveBeenCalledWith(
        '/api/mock-files/0199c000-0000-7000-8000-000200002025',
      );
    });
  });

  it('marks a report submitted by 31 July on time', async () => {
    await show(COMMISSION_ADMIN, { today: '2026-07-28', seed: { submitted: 'on-time' } });
    expect(screen.getByText('On time')).toBeTruthy();
    expect(screen.queryByText(/^Late: due/)).toBeNull();
  });

  it("names the Commission's own system for a report filed through the API", async () => {
    await show(COMMISSION_ADMIN, { today: '2026-07-28', seed: { submitted: 'federated' } });
    expect(screen.getByText("By your Commission's system, 28 Jul 2026, 14:42")).toBeTruthy();
    expect(screen.getByText('Submitted via API')).toBeTruthy();
  });

  it('says a download failed', async () => {
    await show(COMMISSION_ADMIN, {
      seed: { submitted: 'late' },
      actions: mockActions(COMMISSION_ADMIN, {
        documentLink: () =>
          Promise.resolve({ ok: false, error: { kind: 'unavailable', detail: null } }),
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download Form M (PDF)' }));
    expect(await screen.findByText('We could not download the file. Try again.')).toBeTruthy();
  });
});

describe('reminder banners (S7)', () => {
  it.each([
    ['2026-07-17', 'Form M due in 14 days.'],
    ['2026-07-24', 'Form M due in 7 days.'],
    ['2026-07-30', 'Form M due tomorrow.'],
  ])('on %s says "%s"', async (today, banner) => {
    await show(COMMISSION_ADMIN, { today });
    expect(screen.getByText(banner)).toBeTruthy();
    expect(screen.getByText('Submit by 31 Jul 2026.')).toBeTruthy();
  });
});
