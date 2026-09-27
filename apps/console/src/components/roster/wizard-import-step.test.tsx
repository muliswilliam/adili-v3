// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { RosterImport } from '../../server/directory/client';
import { WizardImportStep } from './wizard-import-step';
import { WizardReportStep } from './wizard-report-step';

// The steps link to the roster; a plain anchor stands in for the router's Link.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
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
  startedBy: { kind: 'user', id: 'user-1' },
  startedAt: '2026-09-26T07:40:00Z',
  completedAt: null,
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
      'The import stopped after 30,000 rows: a system error interrupted it.',
    );
    expect(alert.textContent).toContain('Rows already applied are kept.');
    expect(screen.queryByText('You can leave this page; the import continues.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Import a corrected file' }));
    expect(onImportAnother).toHaveBeenCalled();
  });

  it('says nothing changed when it stopped before any row', () => {
    render(
      <WizardImportStep
        imp={imp({
          state: 'failed',
          totalRows: null,
          processedRows: 0,
          failure: { code: 'missing-columns', detail: 'national_id' },
        })}
        reconnecting={false}
        onImportAnother={vi.fn()}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(
      'The import stopped before any rows were applied: the file has no national_id column.',
    );
    expect(alert.textContent).toContain('Nothing on the roster changed.');
  });

  it('shows a placeholder until the first answer', () => {
    render(<WizardImportStep imp={null} reconnecting={false} onImportAnother={vi.fn()} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
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

  it('shows the five counts and that nothing was rejected', () => {
    render(<WizardReportStep imp={completed} onImportAnother={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Import complete' })).toBeTruthy();
    expect(screen.getByText(/psc-new-appointments-sep\.csv · 1,212 rows · finished/)).toBeTruthy();
    const tiles = screen.getByRole('region', { name: 'Import counts' });
    expect(tiles.textContent).toBe('Created41Updated1,169Unchanged2Rejected0Flagged absent0');
    expect(screen.getByText('No rows were rejected.')).toBeTruthy();
    expect(screen.queryByText(/not in this file/)).toBeNull();
  });

  it('warns about officers flagged as absent', () => {
    render(
      <WizardReportStep
        imp={{
          ...completed,
          counts: { ...counts, rejected: 3, flaggedAbsent: 14 },
        }}
        onImportAnother={vi.fn()}
      />,
    );
    expect(screen.getByText('14 officers were not in this file.')).toBeTruthy();
    expect(screen.queryByText('No rows were rejected.')).toBeNull();
  });

  it('goes on to another file', () => {
    const onImportAnother = vi.fn();
    render(<WizardReportStep imp={completed} onImportAnother={onImportAnother} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import another file' }));
    expect(onImportAnother).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Go to roster' })).toBeTruthy();
  });
});
