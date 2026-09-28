// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@adili/ui';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { RosterImport, RosterImportRowPage } from '../../server/directory/client';
import { FailureAlert, WizardImportStep } from './wizard-import-step';
import { WizardReportStep } from './wizard-report-step';

// The steps link to the roster; a plain anchor stands in for the router's Link.
vi.mock('@tanstack/react-router', () => ({
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
        (href, [name, value]) => href.replace(`$${name}`, value),
        to,
      )}
      {...props}
    >
      {children}
    </a>
  ),
}));

const base: RosterImport = {
  id: '0199a0b4-0000-7000-8000-0000000000aa',
  channel: 'file',
  declaredComplete: true,
  state: 'processing',
  fileName: 'psc-roster-2026-09-26.xlsx',
  format: 'xlsx',
  totalRows: 48_431,
  processedRows: 21_400,
  counts: null,
  mapping: null,
  failure: null,
  startedBy: { kind: 'user', id: 'user-1', name: 'Grace Muthoni' },
  startedAt: '2026-09-26T07:40:00Z',
  completedAt: null,
  rowsRetainedUntil: null,
};

const imp = (overrides: Partial<RosterImport>): RosterImport => ({ ...base, ...overrides });

describe('WizardImportStep', () => {
  it('shows rows applied out of the total', () => {
    render(<WizardImportStep imp={base} reconnecting={false} onImportAnother={vi.fn()} />);
    const bar = screen.getByRole('progressbar', { name: 'Import progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('44');
    expect(bar.getAttribute('aria-valuetext')).toBe('21,400 of 48,431 rows');
    expect(screen.getByText('Complete roster')).toBeTruthy();
    expect(screen.getByText('You can leave this page; the import continues.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to roster' }).getAttribute('href')).toBe('/roster');
  });

  it('reads the file while the total is unknown', () => {
    render(
      <WizardImportStep
        imp={imp({ state: 'pending', totalRows: null, processedRows: 0, declaredComplete: false })}
        reconnecting={false}
        onImportAnother={vi.fn()}
      />,
    );
    expect(screen.getByText('Reading the file…')).toBeTruthy();
    expect(screen.getByText('Partial update')).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: 'Import progress' }).hasAttribute('aria-valuenow'),
    ).toBe(false);
  });

  it('says when it lost contact with the import', () => {
    render(<WizardImportStep imp={base} reconnecting onImportAnother={vi.fn()} />);
    expect(screen.getByText('Lost contact with the import. Retrying…')).toBeTruthy();
  });

  it('explains a failure part-way and offers a corrected file', () => {
    const onImportAnother = vi.fn();
    render(
      <WizardImportStep
        imp={imp({
          state: 'failed',
          processedRows: 30_000,
          failure: { code: 'internal', detail: 'Worker lost' },
        })}
        reconnecting={false}
        onImportAnother={onImportAnother}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Import stopped' })).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(
      'The import stopped after 30,000 of 48,431 rows: a system error interrupted it.',
    );
    expect(alert.textContent).toContain('Rows already applied are kept.');
    expect(within(alert).getByRole('link', { name: 'View report' }).getAttribute('href')).toBe(
      `/roster/imports/${base.id}`,
    );
    expect(screen.queryByText('You can leave this page; the import continues.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Import a corrected file' }));
    expect(onImportAnother).toHaveBeenCalled();
  });

  it('counts the rows it stopped after on their own when every row was processed', () => {
    render(
      <WizardImportStep
        imp={imp({
          state: 'failed',
          totalRows: 2,
          processedRows: 2,
          failure: { code: 'internal', detail: '' },
        })}
        reconnecting={false}
        onImportAnother={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'The import stopped after 2 rows: a system error interrupted it.',
    );
  });

  it('says nothing changed when it stopped before any row', () => {
    render(
      <WizardImportStep
        imp={imp({
          state: 'failed',
          totalRows: null,
          processedRows: 0,
          failure: {
            code: 'missing-columns',
            detail: 'The file has no national_id column. Add it and upload the file again.',
          },
        })}
        reconnecting={false}
        onImportAnother={vi.fn()}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(
      'The import stopped before any rows were applied: a required column is missing.',
    );
    expect(alert.textContent).toContain('The file has no national_id column.');
    expect(alert.textContent).toContain('Nothing on the roster changed.');
  });

  it('shows a placeholder until the first answer', () => {
    render(<WizardImportStep imp={null} reconnecting={false} onImportAnother={vi.fn()} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('FailureAlert', () => {
  const apiBatch = (processedRows: number) =>
    imp({
      channel: 'api',
      fileName: null,
      format: null,
      state: 'failed',
      totalRows: 2,
      processedRows,
      failure: { code: 'internal', detail: '' },
      startedBy: { kind: 'client', id: 'roster-psc-3f9a2c1d', name: 'roster-psc-3f9a2c1d' },
    });

  it('tells an HR system batch to be sent again, not a file to be fixed', () => {
    const { unmount } = render(<FailureAlert imp={apiBatch(1)} />);
    let alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(
      'Rows already applied are kept. Your HR system can send the batch again.',
    );
    expect(alert.textContent).not.toContain('file');
    unmount();

    render(<FailureAlert imp={apiBatch(0)} />);
    alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(
      'Nothing on the roster changed. Your HR system can send the batch again.',
    );
  });
});

describe('WizardReportStep', () => {
  const counts = {
    accepted: 1212,
    created: 41,
    updated: 1169,
    unchanged: 2,
    rejected: 0,
    flaggedAbsent: 0,
    exitsRecorded: 0,
  };
  const completed = imp({
    state: 'completed',
    declaredComplete: false,
    fileName: 'psc-new-appointments-sep.csv',
    format: 'csv',
    totalRows: 1212,
    processedRows: 1212,
    completedAt: '2026-09-26T07:42:00Z',
    counts,
  });

  const noRows = vi.fn(() => Promise.reject(new Error('no rows to read')));

  const renderReport = (
    report: RosterImport,
    {
      readRows = noRows,
      onImportAnother = vi.fn(),
    }: {
      readRows?: (cursor: string | undefined) => Promise<{ ok: true; data: RosterImportRowPage }>;
      onImportAnother?: () => void;
    } = {},
  ) =>
    render(
      <ToastProvider>
        <WizardReportStep
          imp={report}
          readRows={readRows}
          returnTo={`/roster/import?import=${report.id}`}
          onImportAnother={onImportAnother}
        />
      </ToastProvider>,
    );

  it('shows the five counts and that nothing was rejected', () => {
    renderReport(completed);
    expect(screen.getByRole('heading', { name: 'Import complete' })).toBeTruthy();
    expect(screen.getByText(/psc-new-appointments-sep\.csv · 1,212 rows · finished/)).toBeTruthy();
    const tiles = screen.getByRole('region', { name: 'Import counts' });
    expect(tiles.textContent).toBe('Created41Updated1,169Unchanged2Rejected0Flagged absent0');
    expect(screen.getByText('No rows were rejected.')).toBeTruthy();
    expect(screen.queryByText(/not in this file/)).toBeNull();
  });

  it('warns about officers flagged as absent and lists the rejected rows', async () => {
    const readRows = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          items: [
            {
              rowNumber: 14,
              status: 'rejected' as const,
              raw: { personnelFileNumber: 'PSC/2020/0014', nationalId: '12' },
              errors: [
                {
                  field: 'nationalId' as const,
                  code: 'format' as const,
                  message: 'National ID must be 5 to 10 digits.',
                },
              ],
              outcome: null,
              recordId: null,
            },
          ],
          nextCursor: null,
        },
      }),
    );
    renderReport(
      { ...completed, counts: { ...counts, rejected: 1, flaggedAbsent: 14 } },
      { readRows },
    );
    expect(screen.getByText('14 officers were not in this file.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Review flagged' }).getAttribute('href')).toBe(
      '/roster/flagged',
    );
    expect(screen.queryByText('No rows were rejected.')).toBeNull();
    const table = await screen.findByRole('table', { name: 'Rejected rows' });
    expect(within(table).getByRole('rowheader', { name: '14' })).toBeTruthy();
    expect(within(table).getByText('national_id')).toBeTruthy();
    expect(within(table).getByText('National ID must be 5 to 10 digits.')).toBeTruthy();
    expect(readRows).toHaveBeenCalledWith(undefined);
    expect(screen.getByRole('button', { name: 'Download rejected rows (CSV)' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: 'Rejected rows pages' })).toBeNull();
    });
  });

  it('says the rows are gone once purged, without asking for them', () => {
    const readRows = vi.fn(noRows);
    renderReport(
      {
        ...completed,
        counts: { ...counts, rejected: 4 },
        rowsRetainedUntil: '2026-01-01T00:00:00Z',
      },
      { readRows },
    );
    expect(screen.getByText('Row details are kept for 30 days after an import ends.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
    expect(readRows).not.toHaveBeenCalled();
  });

  it('goes on to another file', () => {
    const onImportAnother = vi.fn();
    renderReport(completed, { onImportAnother });
    fireEvent.click(screen.getByRole('button', { name: 'Import another file' }));
    expect(onImportAnother).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Go to roster' })).toBeTruthy();
  });
});
