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
  type Remarks,
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
import { FormMWorkspaceView } from './form-m-workspace';
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
  window.sessionStorage.clear();
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
    reset = true,
  }: {
    today?: string;
    seed?: ReportingMockSeed;
    marker?: StepUpMarker | null;
    actions?: SignOffActions;
    /** Seeds the mock afresh (else it stays as the last test step left it). */
    reset?: boolean;
  } = {},
) {
  if (reset) resetReportingMock(today, seed);
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
    unmount: view.unmount,
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

  it.each<[FormMResult<null>, string]>([
    [
      { ok: false, error: { kind: 'problem', problem: { type: 'x', title: 'x', status: 403 } } },
      'Only a supervisor of your Commission can mark Form M reviewed.',
    ],
    [
      {
        ok: false,
        error: {
          kind: 'problem',
          problem: { type: 'x', title: 'x', status: 409, code: 'report-compiling' },
        },
      },
      'The draft is being recompiled. Try again once it is ready.',
    ],
    [
      {
        ok: false,
        error: {
          kind: 'problem',
          problem: { type: 'x', title: 'x', status: 409, code: 'report-submitted' },
        },
      },
      'This report was already submitted.',
    ],
    [
      { ok: false, error: { kind: 'problem', problem: { type: 'x', title: 'x', status: 400 } } },
      'Check the designation and try again.',
    ],
    [
      { ok: false, error: { kind: 'problem', problem: { type: 'x', title: 'x', status: 404 } } },
      'This report is no longer available. Reload the page to see how it stands.',
    ],
    [
      { ok: false, error: { kind: 'unavailable', detail: null } },
      'The draft was not marked reviewed. Try again.',
    ],
  ])('says why Mark reviewed did not go through', async (answer, copy) => {
    await show(SUPERVISOR, {
      actions: mockActions(SUPERVISOR, { markReviewed: () => Promise.resolve(answer) }),
    });
    fireEvent.click(within(footer()).getByRole('button', { name: 'Mark reviewed' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark Form M reviewed' });
    fireEvent.change(within(dialog).getByLabelText('Designation'), {
      target: { value: 'Director' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark reviewed' }));
    expect(await within(dialog).findByText(copy)).toBeTruthy();
  });

  it('sends a signed-out supervisor to sign in, from Mark reviewed or a remark save', async () => {
    const signedOut = () =>
      Promise.resolve({ ok: false, error: { kind: 'unauthenticated' } } as const);
    const { nav } = await show(SUPERVISOR, {
      actions: mockActions(SUPERVISOR, { markReviewed: signedOut, saveRemarks: signedOut }),
    });
    const field = screen.getByRole('textbox', {
      name: 'Remarks for Peter Mwangi Githinji (PSC/2011/0217)',
    });
    fireEvent.change(field, { target: { value: 'x' } });
    fireEvent.blur(field);
    await waitFor(() => {
      expect(nav.signIn).toHaveBeenCalledWith('/form-m?fy=2025');
    });
    nav.signIn.mockClear();
    fireEvent.click(within(footer()).getByRole('button', { name: 'Mark reviewed' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark Form M reviewed' });
    fireEvent.change(within(dialog).getByLabelText('Designation'), {
      target: { value: 'Director' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark reviewed' }));
    await waitFor(() => {
      expect(nav.signIn).toHaveBeenCalledWith('/form-m?fy=2025');
    });
  });

  it('drops from the running map an officer a recompile no longer lists', async () => {
    const sent: Remarks[] = [];
    const base = mockActions(SUPERVISOR);
    const actions: SignOffActions = {
      ...base,
      saveRemarks: (fy, remarks) => {
        sent.push(remarks);
        return base.saveRemarks(fy, remarks);
      },
    };
    resetReportingMock('2026-10-03');
    const loaded = await load('2026-10-03', SUPERVISOR);
    if (!loaded.ok || !loaded.data.report?.document) throw new Error('no draft');
    const view = (result: FormMResult<FormMWorkspace>) => (
      <ToastProvider>
        <TooltipProvider>
          <FormMSignOffView
            key={2025}
            result={result}
            capabilities={formMCapabilities([SUPERVISOR])}
            viewerName="Samuel Njoroge"
            stepUpMarker={null}
            actions={actions}
            navigation={navigation()}
            onSelect={vi.fn()}
            onCompile={vi.fn(() => Promise.resolve({ ok: true, data: null } as const))}
          />
        </TooltipProvider>
      </ToastProvider>
    );
    const { rerender } = render(view(loaded));
    const remarkFor = (name: RegExp) => screen.getByRole('textbox', { name });
    fireEvent.change(remarkFor(/Peter Mwangi Githinji/), { target: { value: 'On sick leave' } });
    fireEvent.blur(remarkFor(/Peter Mwangi Githinji/));
    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    // Recompiled: Peter filed meanwhile, so the biennial list no longer names him.
    const { document } = loaded.data.report;
    const biennial = document.partII.biennial;
    rerender(
      view({
        ok: true,
        data: {
          ...loaded.data,
          report: {
            ...loaded.data.report,
            document: {
              ...document,
              partII: {
                ...document.partII,
                biennial: { ...biennial, nonFilers: biennial.nonFilers.slice(1) },
              },
            },
          },
        },
      }),
    );
    fireEvent.change(remarkFor(/Halima Abdi Hassan/), { target: { value: 'Warned twice' } });
    fireEvent.blur(remarkFor(/Halima Abdi Hassan/));
    await waitFor(() => {
      expect(sent).toHaveLength(2);
    });
    expect(sent[1]).toEqual({ '0199b000-0000-7000-8000-000000000202': 'Warned twice' });
  });

  it('says why a remark was not saved when the report was submitted meanwhile', async () => {
    await show(SUPERVISOR, {
      actions: mockActions(SUPERVISOR, {
        saveRemarks: () =>
          Promise.resolve({
            ok: false,
            error: {
              kind: 'problem',
              problem: { type: 'x', title: 'x', status: 409, code: 'report-submitted' },
            },
          }),
      }),
    });
    const field = screen.getByRole('textbox', { name: /Peter Mwangi Githinji/ });
    fireEvent.change(field, { target: { value: 'x' } });
    fireEvent.blur(field);
    expect(
      await screen.findByText('Not saved: the report was submitted meanwhile. Reload the page.'),
    ).toBeTruthy();
  });

  it('saves remarks from two sections in one running map', async () => {
    const sent: Remarks[] = [];
    const base = mockActions(SUPERVISOR);
    await show(SUPERVISOR, {
      actions: {
        ...base,
        saveRemarks: (fy, remarks) => {
          sent.push(remarks);
          return base.saveRemarks(fy, remarks);
        },
      },
    });
    const peter = screen.getByRole('textbox', {
      name: 'Remarks for Peter Mwangi Githinji (PSC/2011/0217)',
    });
    const lucy = screen.getByRole('textbox', {
      name: 'Remarks for Lucy Atieno Odhiambo (PSC/2004/0061)',
    });
    fireEvent.change(peter, { target: { value: 'On sick leave' } });
    fireEvent.change(lucy, { target: { value: 'Retired abroad' } });
    fireEvent.blur(lucy);
    await waitFor(() => {
      expect(sent.at(-1)).toEqual({
        '0199b000-0000-7000-8000-000000000201': 'On sick leave',
        '0199b000-0000-7000-8000-000000000301': 'Retired abroad',
      });
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
      { status: 'key-reused' },
      'Form M was not submitted.',
      'This confirmation was sent before with other details. Reload the page and confirm again.',
    ],
    [
      { status: 'not-found' },
      'Form M was not submitted.',
      'This report is no longer available. Reload the page to see how it stands.',
    ],
    [
      { status: 'invalid' },
      'Form M was not submitted.',
      'The service could not take this confirmation. Reload the page and confirm again.',
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

  it('sends the same key after a timeout, the dialog closed and the step-up done again', async () => {
    const keys: string[] = [];
    const base = mockActions(COMMISSION_ADMIN);
    const actions: SignOffActions = {
      ...base,
      confirm: (fy, key) => {
        keys.push(key);
        return keys.length === 1
          ? Promise.resolve({ status: 'unavailable' })
          : base.confirm(fy, key);
      },
    };
    const first = await show(COMMISSION_ADMIN, { seed: ready, marker: 'done', actions });
    let dialog = await screen.findByRole('dialog', { name: 'Confirm and submit Form M' });
    fireEvent.click(within(dialog).getByLabelText('I confirm the information is correct'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and submit' }));
    await within(dialog).findByText('Form M was not submitted. Try again. Nothing was sent twice.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    first.unmount();

    // Back from another step-up: a new page, the same tab.
    await show(COMMISSION_ADMIN, { marker: 'done', actions, reset: false });
    dialog = await screen.findByRole('dialog', { name: 'Confirm and submit Form M' });
    fireEvent.click(within(dialog).getByLabelText('I confirm the information is correct'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and submit' }));
    await waitFor(() => {
      expect(keys).toHaveLength(2);
    });
    expect(keys[1]).toBe(keys[0]);
    await waitFor(async () => {
      expect((await report()).status).toBe('submitted');
    });
    // Known now: the next confirmation gets a key of its own.
    expect(window.sessionStorage.length).toBe(0);
  });

  it('says a one-time code comes first once the report is ready', async () => {
    await show(COMMISSION_ADMIN, { seed: ready });
    expect(
      within(footer()).getByText(
        'You will confirm your identity with a one-time code before submitting.',
      ),
    ).toBeTruthy();
  });

  it('holds Confirm and submit back while a Part I change was refused', async () => {
    const base = mockActions(COMMISSION_ADMIN);
    await show(COMMISSION_ADMIN, {
      seed: ready,
      actions: {
        ...base,
        saveManualFields: () =>
          Promise.resolve({
            ok: false,
            error: { kind: 'problem', problem: { type: 'about:blank', title: 'No', status: 400 } },
          }),
      },
    });
    const contact = screen.getByLabelText('(ii) Contact details');
    fireEvent.change(contact, { target: { value: '+254 20 000 0000' } });
    fireEvent.blur(contact);
    expect(
      await screen.findByText('Not saved: the service refused this change. Reload the page.'),
    ).toBeTruthy();
    expect(confirmButton()).toHaveProperty('disabled', true);
    expect(
      within(footer()).getByText(
        'Some changes were not saved. Edit them again, or reload the page.',
      ),
    ).toBeTruthy();
  });

  it('says a confirmation still being processed, and keeps the dialog to try again', async () => {
    await show(COMMISSION_ADMIN, {
      seed: ready,
      marker: 'done',
      actions: mockActions(COMMISSION_ADMIN, {
        confirm: () => Promise.resolve({ status: 'busy' }),
      }),
    });
    const dialog = await screen.findByRole('dialog', { name: 'Confirm and submit Form M' });
    fireEvent.click(within(dialog).getByLabelText('I confirm the information is correct'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and submit' }));
    expect(
      await within(dialog).findByText(
        'Still being processed. Try again shortly; nothing will be sent twice.',
      ),
    ).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(window.sessionStorage.length).toBe(1);
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

describe("the footer note's extension", () => {
  it('says nothing when the extension says null, and the default when it says undefined', async () => {
    resetReportingMock('2026-10-03');
    const result = await load('2026-10-03', REPORTING_OFFICER);
    const view = (note: null | undefined) => (
      <TooltipProvider>
        <FormMWorkspaceView
          result={result}
          capabilities={formMCapabilities([REPORTING_OFFICER])}
          onSelect={vi.fn()}
          onCompile={vi.fn(() => Promise.resolve({ ok: true, data: null } as const))}
          extensions={{ footerNote: () => note }}
        />
      </TooltipProvider>
    );
    const { rerender } = render(view(null));
    expect(within(footer()).queryByText('Read only')).toBeNull();
    rerender(view(undefined));
    expect(within(footer()).getByText('Read only')).toBeTruthy();
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
