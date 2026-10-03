// @vitest-environment jsdom
import { REPORTING_OFFICER, SUPERVISOR } from '@adili/roles';
import { TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  compileReport,
  type FormMResult,
  type FormMWorkspace,
  loadWorkspace,
} from '../../server/form-m.server';
import {
  mockReportingClient,
  resetReportingMock,
  setReportingMockLatency,
} from '../../server/reporting/mock.server';
import { FormMWorkspaceView } from './form-m-workspace';

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

async function load(
  today: string,
  { fy, roles = [SUPERVISOR] }: { fy?: number; roles?: string[] } = {},
): Promise<FormMResult<FormMWorkspace>> {
  return loadWorkspace(mockReportingClient(roles), 'psc', { fy, today });
}

/** Clicks, then lets the handler's promises settle. */
async function click(press: () => void) {
  await act(async () => {
    press();
    await Promise.resolve();
  });
}

function show(
  result: FormMResult<FormMWorkspace> | null,
  {
    roles = [SUPERVISOR],
    onCompile = vi.fn(() => Promise.resolve({ ok: true, data: null } as const)),
    onSelect = vi.fn(),
  }: {
    roles?: string[];
    onCompile?: (fy: number) => Promise<FormMResult<null>>;
    onSelect?: (fy: number) => void;
  } = {},
) {
  render(
    <TooltipProvider>
      <FormMWorkspaceView result={result} roles={roles} onCompile={onCompile} onSelect={onSelect} />
    </TooltipProvider>,
  );
  return { onCompile, onSelect };
}

describe('the Form M workspace (S15)', () => {
  it('shows a loading skeleton while the periods load', () => {
    show(null);
    expect(screen.getByRole('heading', { name: 'Form M compliance report' })).toBeTruthy();
    expect(screen.getByLabelText('Loading Form M').getAttribute('aria-busy')).toBe('true');
  });

  it('offers a retry when Form M could not load', () => {
    show({ ok: false, error: { kind: 'unavailable', detail: null } });
    expect(screen.getByText('We could not load Form M')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(invalidate).toHaveBeenCalled();
  });

  it('lists the financial years, marks the current one and selects another', async () => {
    resetReportingMock('2026-10-03');
    const { onSelect } = show(await load('2026-10-03'));
    const years = within(screen.getByRole('group', { name: 'Financial year' }));
    const current = years.getByRole('button', { name: /FY 2026\/2027/ });
    expect(current.textContent).toContain('Current');
    expect(current.textContent).toContain('Not started');
    expect(current.textContent).toContain('Preview from 1 Apr 2027 · Due 31 Jul 2027');
    const selected = years.getByRole('button', { name: /FY 2025\/2026/ });
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(selected.textContent).toContain('Was due 31 Jul 2026 · 64 days overdue');
    fireEvent.click(current);
    expect(onSelect).toHaveBeenCalledWith(2026);
  });

  it('says a year with no draft compiles on 1 July before previews open', async () => {
    resetReportingMock('2026-10-03');
    show(await load('2026-10-03', { fy: 2026 }));
    expect(screen.getByText('No draft yet')).toBeTruthy();
    expect(
      screen.getByText(
        'Form M for FY 2026/2027 compiles automatically on 1 July. Preview available from 1 April.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Compile preview' })).toBeNull();
  });

  it('lets the supervisor compile a preview from 1 April', async () => {
    resetReportingMock('2027-04-10');
    const { onCompile } = show(await load('2027-04-10', { fy: 2026 }));
    expect(screen.getByText('Preview Form M for FY 2026/2027')).toBeTruthy();
    expect(
      screen.getByText("A preview uses today's data. The final draft is compiled on 1 July."),
    ).toBeTruthy();
    await click(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Compile preview' }));
    });
    expect(onCompile).toHaveBeenCalledWith(2026);
    expect(invalidate).toHaveBeenCalled();
  });

  it('tells other roles the supervisor compiles the preview', async () => {
    resetReportingMock('2027-04-10');
    show(await load('2027-04-10', { fy: 2026, roles: [REPORTING_OFFICER] }), {
      roles: [REPORTING_OFFICER],
    });
    expect(screen.queryByRole('button', { name: 'Compile preview' })).toBeNull();
    expect(screen.getByText('Your supervisor can compile a preview.')).toBeTruthy();
  });

  it('shows why a compile was refused', async () => {
    resetReportingMock('2027-04-10');
    const refused = await compileReport(mockReportingClient([SUPERVISOR]), 'psc', 2025);
    show(await load('2027-04-10', { fy: 2026 }), { onCompile: () => Promise.resolve(refused) });
    expect(refused.ok).toBe(false);
    await click(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Compile preview' }));
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'This report is submitted and can no longer be compiled.',
    );
  });

  it('says from when a preview of the year can be compiled when refused too early', async () => {
    resetReportingMock('2027-04-10');
    show(await load('2027-04-10', { fy: 2026 }), {
      onCompile: () =>
        Promise.resolve({
          ok: false,
          error: {
            kind: 'problem',
            problem: {
              type: 'about:blank',
              title: 'x',
              status: 409,
              code: 'preview-not-available',
            },
          },
        }),
    });
    await click(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Compile preview' }));
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'A preview of this year can be compiled from 1 Apr 2027.',
    );
  });

  it('shows progress while compiling', async () => {
    resetReportingMock('2027-04-10');
    await compileReport(mockReportingClient([SUPERVISOR]), 'psc', 2026);
    show(await load('2027-04-10', { fy: 2026 }));
    const status = screen.getByRole('status');
    expect(status.textContent).toContain(
      'Compiling from your roster, filings, clarifications and actions…',
    );
    expect(status.textContent).toContain('You can leave this page. We will notify you.');
  });

  it('renders every part of the overdue draft for the supervisor, with Recompile', async () => {
    resetReportingMock('2026-10-03');
    const { onCompile } = show(await load('2026-10-03'));
    expect(screen.getByRole('alert').textContent).toContain('64 days overdue.');
    expect(screen.getByRole('heading', { name: 'As at 22 Sep 2026, 06:00' })).toBeTruthy();
    for (const name of [
      'Part I: Description of the Responsible Commission',
      /Submission of initial declaration/,
      /Submission of biennial declaration/,
      /Submission of final declaration/,
      /Clarifications sought from public officers/,
      /Access to information in a declaration/,
      'B. Complaints and investigations',
      'Part III: Authentication of information',
    ]) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    expect(screen.getAllByText('Not filled yet')).toHaveLength(2);
    expect(screen.getByRole('table', { name: /Section 1\(d\)/ })).toBeTruthy();
    const clarifications = screen.getByRole('table', {
      name: /Section 4: List of public officers/,
    });
    expect(within(clarifications).getAllByRole('row')).toHaveLength(7);
    expect(screen.getByText('Access request data is not yet captured on Adili.')).toBeTruthy();
    expect(screen.getByText('Not answered yet')).toBeTruthy();
    expect(screen.getByText('No complaints recorded.')).toBeTruthy();
    // Remarks stay read-only here; editing them comes with the sign-off screens (#226).
    expect(screen.queryByRole('textbox')).toBeNull();

    const signOff = within(screen.getByRole('region', { name: 'Sign-off' }));
    expect(signOff.getByText('Draft compiled')).toBeTruthy();
    expect(signOff.getByText('Missing contact details, email address')).toBeTruthy();
    const nav = within(screen.getByRole('navigation', { name: 'Form M sections' }));
    expect(nav.getByRole('link', { name: /2\. Biennial declarations/ }).getAttribute('href')).toBe(
      '#form-m-section-2',
    );

    expect(screen.getByText('Due 31 July 2026 · 64 days overdue')).toBeTruthy();
    await click(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Recompile' }));
    });
    expect(onCompile).toHaveBeenCalledWith(2025);
  });

  it('shows the draft read-only to the reporting officer', async () => {
    resetReportingMock('2026-10-03');
    show(await load('2026-10-03', { roles: [REPORTING_OFFICER] }), { roles: [REPORTING_OFFICER] });
    expect(screen.queryByRole('button', { name: 'Recompile' })).toBeNull();
    expect(screen.getByText('Read only')).toBeTruthy();
  });

  it('marks a preview, with no biennial cycle in an even year and section 5 counts', async () => {
    resetReportingMock('2027-04-10');
    await compileReport(mockReportingClient([SUPERVISOR]), 'psc', 2026);
    setReportingMockLatency(0, { compileMs: 0 });
    const result = await load('2027-04-10', { fy: 2026 });
    setReportingMockLatency(0);
    show(result);
    expect(screen.getByText("Preview from today's data.")).toBeTruthy();
    expect(screen.getByText('The final draft compiles on 1 Jul 2027.')).toBeTruthy();
    expect(screen.getByText('No biennial cycle in this period.')).toBeTruthy();
    expect(screen.queryByText('Access request data is not yet captured on Adili.')).toBeNull();
    expect(screen.getByText('Frivolous or vexatious')).toBeTruthy();
    expect(screen.getByText('Preview compiled')).toBeTruthy();
    expect(screen.getByText('Preview. Submit after 30 Jun 2027.')).toBeTruthy();
    expect(screen.getByText('Due 31 July 2027 · 112 days left')).toBeTruthy();
    const years = within(screen.getByRole('group', { name: 'Financial year' }));
    expect(years.getByRole('button', { name: /FY 2026\/2027/ }).textContent).toContain('Preview');
  });
});
