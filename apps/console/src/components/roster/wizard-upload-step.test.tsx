// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { UploadState } from './import-wizard';
import { WizardUploadStep } from './wizard-upload-step';

const file = { name: 'psc-roster-2026-09-26.xlsx', size: 4.3 * 1024 * 1024 };

function renderStep(upload: UploadState) {
  const props = {
    upload,
    onFile: vi.fn(),
    onCancel: vi.fn(),
    onRetry: vi.fn(),
    onChooseAnother: vi.fn(),
    onBack: vi.fn(),
  };
  const view = render(<WizardUploadStep {...props} />);
  return { ...props, ...view };
}

function pick(container: HTMLElement, picked: File) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input');
  fireEvent.change(input, { target: { files: [picked] } });
}

function sized(name: string, bytes: number) {
  const picked = new File(['x'], name);
  Object.defineProperty(picked, 'size', { value: bytes });
  return picked;
}

describe('WizardUploadStep', () => {
  it('offers the drop zone with the formats and limits', () => {
    renderStep({ phase: 'idle' });
    const zone = screen.getByRole('button', { name: 'Drop your roster file here or browse.' });
    expect(zone.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('CSV (UTF-8) or Excel. Up to 50 MB and 1,000,000 rows.')).toBeTruthy();
  });

  it('refuses a file over 50 MB before any request', () => {
    const { container, onFile } = renderStep({ phase: 'idle' });
    pick(container, sized('roster.xlsx', 63.4 * 1024 * 1024));
    expect(screen.getByText('This file is 63.4 MB. The limit is 50 MB.')).toBeTruthy();
    expect(onFile).not.toHaveBeenCalled();
  });

  it('refuses a file that is not CSV or XLSX before any request', () => {
    const { container, onFile } = renderStep({ phase: 'idle' });
    pick(container, sized('photo.png', 1000));
    expect(screen.getByText('Use a .csv or .xlsx file.')).toBeTruthy();
    expect(onFile).not.toHaveBeenCalled();
  });

  it('hands on an accepted file', () => {
    const { container, onFile } = renderStep({ phase: 'idle' });
    const picked = sized('roster.csv', 1000);
    pick(container, picked);
    expect(onFile).toHaveBeenCalledWith(picked);
  });

  it('shows the upload being prepared', () => {
    renderStep({ phase: 'requesting', file });
    expect(screen.getByText(file.name)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Preparing upload…');
  });

  it('shows upload progress with a cancel', () => {
    const { onCancel } = renderStep({ phase: 'uploading', file, percent: 62 });
    const bar = screen.getByRole('progressbar', { name: 'Upload progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('62');
    expect(screen.getByText('62%')).toBeTruthy();
    expect(screen.getByText('4.3 MB')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `Cancel uploading ${file.name}` }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows the scan', () => {
    renderStep({ phase: 'scanning', file });
    expect(screen.getByRole('status').textContent).toBe('Checking the file…');
  });

  it('explains a file that failed the scan', () => {
    const { onChooseAnother } = renderStep({ phase: 'infected', file });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('This file failed the security scan and was not imported.');
    expect(alert.textContent).toContain('Scan the source computer and export the file again.');
    expect(screen.getByText('Failed scan')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose another file' }));
    expect(onChooseAnother).toHaveBeenCalled();
  });

  it.each([
    ['type', 'This is not a CSV or Excel file.'],
    [
      'encoding',
      'This CSV is not saved as UTF-8.In Excel, choose Save As > CSV UTF-8 (Comma delimited)',
    ],
    ['size', 'The file is over 50 MB.'],
  ] as const)('explains a file the service rejected for its %s', (reason, text) => {
    renderStep({ phase: 'rejected', file, reason });
    expect(screen.getByRole('alert').textContent).toContain(text);
    expect(screen.getByText('Not uploaded')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
  });

  it('says an empty file is empty and offers another file, not Try again (#713)', () => {
    const { onChooseAnother } = renderStep({
      phase: 'rejected',
      file: { name: 'roster.csv', size: 0 },
      reason: 'empty',
    });
    expect(screen.getByRole('alert').textContent).toContain('This file is empty.');
    expect(screen.queryByText('The upload did not complete. Try again.')).toBeNull();
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose another file' }));
    expect(onChooseAnother).toHaveBeenCalled();
  });

  it('offers to try again after an upload that did not complete', () => {
    const { onRetry } = renderStep({ phase: 'failed', file });
    expect(screen.getByRole('alert').textContent).toContain(
      'The upload did not complete. Try again.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('goes back to the template', () => {
    const { onBack } = renderStep({ phase: 'idle' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });
});
