// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RosterImportPreview } from '../../server/directory/client';
import {
  type ColumnCheckView,
  WizardCheckStep,
  type WizardCheckStepProps,
} from './wizard-check-step';

const upload = {
  id: '0199a0b4-0000-7000-8000-000000000001',
  fileName: 'psc-roster-2026-09-26.xlsx',
  size: 4.3 * 1024 * 1024,
};

const allMatched: RosterImportPreview = {
  uploadId: upload.id,
  fileName: upload.fileName,
  format: 'xlsx',
  missingRequired: [],
  mapping: {
    matched: [
      { source: 'Personnel File Number', field: 'personnel_file_number' },
      { source: 'Full Name', field: 'full_name' },
      { source: 'National ID', field: 'national_id' },
    ],
    ignored: ['Station'],
    missing: ['phone'],
  },
  estimatedRows: 48_431,
};

const noNationalId: RosterImportPreview = {
  uploadId: upload.id,
  fileName: 'psc-roster-hr-extract.csv',
  format: 'csv',
  missingRequired: ['national_id'],
  mapping: {
    matched: [
      { source: 'File No', field: 'personnel_file_number' },
      { source: 'Full Name', field: 'full_name' },
    ],
    ignored: [],
    missing: [],
  },
  estimatedRows: 1188,
};

function renderStep(check: ColumnCheckView, overrides: Partial<WizardCheckStepProps> = {}) {
  const props: WizardCheckStepProps = {
    upload,
    check,
    declaredComplete: false,
    onDeclaredCompleteChange: vi.fn(),
    starting: false,
    startFailure: null,
    onStart: vi.fn(),
    onRetryCheck: vi.fn(),
    onViewRunning: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
  render(<WizardCheckStep {...props} />);
  return props;
}

const ready = (preview: RosterImportPreview, defaulted = false): ColumnCheckView => ({
  phase: 'ready',
  preview,
  defaulted,
});

describe('WizardCheckStep', () => {
  it('says the columns are being checked', () => {
    renderStep({ phase: 'loading' });
    expect(screen.getByRole('status').textContent).toContain('Checking the columns…');
    expect(screen.queryByRole('button', { name: 'Start import' })).toBeNull();
  });

  it('shows the mapping with badges and the rows detected', () => {
    renderStep(ready(allMatched));
    expect(screen.getByText('48,431 rows')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Column mapping' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      'Personnel File Numberpersonnel_file_numberMatched',
      'Full Namefull_nameMatched',
      'National IDnational_idMatched',
      'Not in filephone optionalNot in file',
      'StationNot importedIgnored',
    ]);
    expect(
      screen.getByText('To import an ignored column, rename it to match the template.'),
    ).toBeTruthy();
  });

  it('blocks the start when a required column is missing', () => {
    const { onBack } = renderStep(ready(noNationalId));
    const table = screen.getByRole('table', { name: 'Column mapping' });
    expect(within(table).getAllByRole('row')[1]?.textContent).toBe(
      'Not foundnational_id requiredMissing',
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('A required column is missing.');
    expect(alert.textContent).toContain('Add a national_id column and upload again.');
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start import' }).disabled).toBe(
      true,
    );
    expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true);

    fireEvent.click(within(alert).getByRole('button', { name: 'Upload again' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('offers the complete-roster choice and starts the import', () => {
    const { onDeclaredCompleteChange, onStart } = renderStep(ready(allMatched));
    const box = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'This file is the complete roster',
    });
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(onDeclaredCompleteChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start import' }));
    expect(onStart).toHaveBeenCalled();
  });

  it('says why the box is ticked on a first import', () => {
    renderStep(ready(allMatched, true), { declaredComplete: true });
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', {
        name: 'This file is the complete roster',
      }).checked,
    ).toBe(true);
    expect(screen.getByText('Checked because your roster is empty.')).toBeTruthy();
  });

  it('disables the start while it is being sent', () => {
    renderStep(ready(allMatched), { starting: true });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Starting…' }).disabled).toBe(
      true,
    );
  });

  it('explains an import already running, with a way to it', () => {
    const { onViewRunning } = renderStep(ready(allMatched), { startFailure: 'running' });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Another import is running.');
    fireEvent.click(within(alert).getByRole('button', { name: 'View progress' }));
    expect(onViewRunning).toHaveBeenCalled();
  });

  it('says a start still being processed can be tried again shortly', () => {
    renderStep(ready(allMatched), { startFailure: 'processing' });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Still starting this import.');
    expect(alert.textContent).toContain('Try again in a few seconds.');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start import' }).disabled).toBe(
      false,
    );
  });

  it('explains a rate limit', () => {
    renderStep(ready(allMatched), { startFailure: 'limited' });
    expect(screen.getByRole('alert').textContent).toContain('Too many requests.');
  });

  it('offers a retry when the check failed', () => {
    const { onRetryCheck } = renderStep({ phase: 'failed', failure: 'failed' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryCheck).toHaveBeenCalled();
  });

  it('asks for the file again when it cannot be read, saying why', () => {
    const { onBack } = renderStep({
      phase: 'failed',
      failure: 'unreadable',
      detail: 'The file is empty.',
    });
    expect(screen.getByRole('alert').textContent).toContain('This file could not be read.');
    expect(screen.getByRole('alert').textContent).toContain('The file is empty.');
    fireEvent.click(screen.getByRole('button', { name: 'Upload again' }));
    expect(onBack).toHaveBeenCalled();
  });
});
