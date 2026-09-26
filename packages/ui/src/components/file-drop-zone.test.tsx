import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FileDropZone, type FileDropZoneProps, matchesAccept } from './file-drop-zone';

const MB = 1024 * 1024;

function file(name: string, size: number, type = '') {
  const result = new File(['x'], name, { type });
  Object.defineProperty(result, 'size', { value: size });
  return result;
}

function renderZone(props: Partial<FileDropZoneProps> = {}) {
  const onFileAccepted = vi.fn();
  const onFileRejected = vi.fn();
  render(
    <FileDropZone
      label="Drop your roster file here or browse."
      hint="CSV (UTF-8) or Excel. Up to 50 MB."
      accept={['.csv', '.xlsx']}
      maxSize={50 * MB}
      messages={{
        type: () => 'Use a .csv or .xlsx file.',
        size: (f) => `This file is ${String(Math.round(f.size / MB))} MB. The limit is 50 MB.`,
      }}
      onFileAccepted={onFileAccepted}
      onFileRejected={onFileRejected}
      {...props}
    />,
  );
  const button = screen.getByRole('button', { name: 'Drop your roster file here or browse.' });
  return { button, onFileAccepted, onFileRejected };
}

function fileInput() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('file input not rendered');
  return input;
}

function drop(target: HTMLElement, dropped: File) {
  fireEvent.drop(target, { dataTransfer: { files: [dropped] } });
}

describe('FileDropZone', () => {
  it('is a labelled button that opens the file picker', () => {
    const { button } = renderZone();
    const input = fileInput();
    const click = vi.spyOn(input, 'click');

    fireEvent.click(button);

    expect(click).toHaveBeenCalled();
    expect(input.accept).toBe('.csv,.xlsx');
    expect(button.getAttribute('aria-describedby')).toBe(
      screen.getByText('CSV (UTF-8) or Excel. Up to 50 MB.').id,
    );
  });

  it('accepts a dropped file of the right type and size', () => {
    const { button, onFileAccepted } = renderZone();
    const roster = file('roster.csv', 2 * MB, 'text/csv');

    drop(button, roster);

    expect(onFileAccepted).toHaveBeenCalledWith(roster);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rejects the wrong type with the message passed in', () => {
    const { button, onFileAccepted, onFileRejected } = renderZone();

    drop(button, file('roster.pdf', MB, 'application/pdf'));

    expect(onFileAccepted).not.toHaveBeenCalled();
    expect(onFileRejected).toHaveBeenCalledWith(expect.any(File), 'type');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Use a .csv or .xlsx file.');
    expect(button.getAttribute('aria-invalid')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('rejects an oversize file picked with the keyboard', () => {
    const { onFileAccepted } = renderZone();
    fireEvent.change(fileInput(), {
      target: { files: [file('roster.xlsx', 60 * MB)] },
    });

    expect(onFileAccepted).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('This file is 60 MB. The limit is 50 MB.');
  });

  it('shows the drag state while a file is over the zone', () => {
    const { button } = renderZone();

    fireEvent.dragEnter(button);
    expect(button.hasAttribute('data-dragging')).toBe(true);
    fireEvent.dragLeave(button);
    expect(button.hasAttribute('data-dragging')).toBe(false);
  });
});

describe('matchesAccept', () => {
  it('matches extensions, exact MIME types and wildcards', () => {
    expect(matchesAccept(file('A.CSV', 1), ['.csv'])).toBe(true);
    expect(matchesAccept(file('a.png', 1, 'image/png'), ['image/*'])).toBe(true);
    expect(matchesAccept(file('a', 1, 'text/csv'), ['text/csv'])).toBe(true);
    expect(matchesAccept(file('a.txt', 1, 'text/plain'), ['.csv', 'text/csv'])).toBe(false);
    expect(matchesAccept(file('a.txt', 1), [])).toBe(true);
  });
});
