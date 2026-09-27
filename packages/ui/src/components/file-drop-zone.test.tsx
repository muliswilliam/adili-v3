import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FileDropZone, type FileDropZoneProps, matchesAccept } from './file-drop-zone';
import { FormField } from './form-field';

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

  it('keeps a visible focus outline', () => {
    const { button } = renderZone();

    expect(button.className).not.toContain('outline-none');
    expect(button.className).toContain('outline-hidden');
    expect(button.className).toContain('focus-visible:outline-2');
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

  it('keeps its hint and error ids when a wrapper passes aria-describedby', () => {
    render(
      <FormField label="Roster file" hint="One file per import." error="The server rejected it.">
        <FileDropZone
          label="Drop your roster file here or browse."
          hint="CSV only."
          accept={['.csv']}
          messages={{ type: () => 'Use a .csv file.', size: () => 'Too big.' }}
          onFileAccepted={vi.fn()}
        />
      </FormField>,
    );
    const button = screen.getByRole('button', { name: 'Drop your roster file here or browse.' });

    drop(button, file('roster.pdf', MB, 'application/pdf'));

    const ids = button.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(ids).toContain(screen.getByText('One file per import.').id);
    expect(ids).toContain(screen.getByText('CSV only.').id);
    const errors = screen.getAllByRole('alert');
    expect(errors).toHaveLength(2);
    for (const error of errors) expect(ids).toContain(error.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(button.getAttribute('aria-invalid')).toBe('true');
  });

  it('still validates a dropped file when the caller handles onDrop', () => {
    const onDrop = vi.fn();
    const { button, onFileAccepted, onFileRejected } = renderZone({ onDrop });

    drop(button, file('roster.pdf', MB, 'application/pdf'));
    expect(onDrop).toHaveBeenCalled();
    expect(onFileAccepted).not.toHaveBeenCalled();
    expect(onFileRejected).toHaveBeenCalledWith(expect.any(File), 'type');

    drop(button, file('roster.csv', 60 * MB, 'text/csv'));
    expect(onFileRejected).toHaveBeenLastCalledWith(expect.any(File), 'size');
  });

  it('runs the caller drag handlers alongside its own drag state', () => {
    const onDragEnter = vi.fn();
    const { button } = renderZone({ onDragEnter });

    fireEvent.dragEnter(button);

    expect(onDragEnter).toHaveBeenCalled();
    expect(button.hasAttribute('data-dragging')).toBe(true);
  });

  it('shows an error passed in from outside', () => {
    const { button } = renderZone({ error: 'The server could not read this file.' });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('The server could not read this file.');
    expect(button.getAttribute('aria-invalid')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('shows whichever error came last, client or server', () => {
    function Upload() {
      const [error, setError] = useState<string | undefined>('Row 4 has no ID number.');
      return (
        <>
          <FileDropZone
            label="Drop your roster file here or browse."
            accept={['.csv']}
            messages={{ type: () => 'Use a .csv file.', size: () => 'Too big.' }}
            onFileAccepted={vi.fn()}
            error={error}
          />
          <button
            type="button"
            onClick={() => {
              setError('Row 9 has no ID number.');
            }}
          >
            Server says
          </button>
        </>
      );
    }
    render(<Upload />);
    const zone = screen.getByRole('button', { name: 'Drop your roster file here or browse.' });
    expect(screen.getByRole('alert').textContent).toBe('Row 4 has no ID number.');

    drop(zone, file('roster.pdf', MB, 'application/pdf'));
    expect(screen.getByRole('alert').textContent).toBe('Use a .csv file.');

    fireEvent.click(screen.getByRole('button', { name: 'Server says' }));
    expect(screen.getByRole('alert').textContent).toBe('Row 9 has no ID number.');
  });

  it('keeps a client message when the parent clears its error on rejection', () => {
    function Upload() {
      const [error, setError] = useState<string | undefined>('Server said no');
      return (
        <FileDropZone
          label="Drop your roster file here or browse."
          accept={['.csv']}
          messages={{ type: () => 'Use a .csv file.', size: () => 'Too big.' }}
          onFileAccepted={() => {
            setError(undefined);
          }}
          onFileRejected={() => {
            setError(undefined);
          }}
          error={error}
        />
      );
    }
    render(<Upload />);
    const zone = screen.getByRole('button', { name: 'Drop your roster file here or browse.' });
    expect(screen.getByRole('alert').textContent).toBe('Server said no');

    drop(zone, file('roster.pdf', MB, 'application/pdf'));

    expect(screen.getByRole('alert').textContent).toBe('Use a .csv file.');
  });

  it('keeps a client message when an inline node error re-renders', () => {
    function Upload() {
      const [, setTick] = useState(0);
      return (
        <FileDropZone
          label="Drop your roster file here or browse."
          accept={['.csv']}
          messages={{ type: () => 'Use a .csv file.', size: () => 'Too big.' }}
          onFileAccepted={vi.fn()}
          onFileRejected={() => {
            setTick((tick) => tick + 1);
          }}
          error={<span>Server said no</span>}
        />
      );
    }
    render(<Upload />);
    const zone = screen.getByRole('button', { name: 'Drop your roster file here or browse.' });

    drop(zone, file('roster.pdf', MB, 'application/pdf'));

    expect(screen.getByRole('alert').textContent).toBe('Use a .csv file.');
  });

  it('shows the same server message again once the parent sets it after a rejection', () => {
    function Upload() {
      const [error, setError] = useState<string | undefined>('Server said no');
      return (
        <>
          <FileDropZone
            label="Drop your roster file here or browse."
            accept={['.csv']}
            messages={{ type: () => 'Use a .csv file.', size: () => 'Too big.' }}
            onFileAccepted={vi.fn()}
            onFileRejected={() => {
              setError(undefined);
            }}
            error={error}
          />
          <button
            type="button"
            onClick={() => {
              setError('Server said no');
            }}
          >
            Server says
          </button>
        </>
      );
    }
    render(<Upload />);
    const zone = screen.getByRole('button', { name: 'Drop your roster file here or browse.' });

    drop(zone, file('roster.pdf', MB, 'application/pdf'));
    expect(screen.getByRole('alert').textContent).toBe('Use a .csv file.');

    fireEvent.click(screen.getByRole('button', { name: 'Server says' }));
    expect(screen.getByRole('alert').textContent).toBe('Server said no');
  });

  it('shows an unchanged server message again after the next accepted file', () => {
    const { button } = renderZone({ error: 'Server said no' });

    drop(button, file('roster.pdf', MB, 'application/pdf'));
    expect(screen.getByRole('alert').textContent).toBe('Use a .csv or .xlsx file.');

    drop(button, file('roster.csv', MB, 'text/csv'));
    expect(screen.getByRole('alert').textContent).toBe('Server said no');
  });

  it('ignores clicks and drops while disabled', () => {
    const { button, onFileAccepted } = renderZone({ disabled: true });
    const click = vi.spyOn(fileInput(), 'click');

    fireEvent.click(button);
    drop(button, file('roster.csv', MB, 'text/csv'));

    expect(click).not.toHaveBeenCalled();
    expect(onFileAccepted).not.toHaveBeenCalled();
  });

  it('stops a file dropped on a disabled zone from opening in the browser', () => {
    const { button, onFileAccepted } = renderZone({ disabled: true });
    // Browsers do not dispatch drag events to a disabled button, so the wrapper handles them.
    const wrapper = button.parentElement;
    if (!wrapper) throw new Error('wrapper not rendered');

    const dataTransfer = { dropEffect: 'copy', files: [] };
    expect(fireEvent.dragOver(wrapper, { dataTransfer })).toBe(false);
    expect(dataTransfer.dropEffect).toBe('none');
    expect(fireEvent.drop(wrapper, { dataTransfer: { files: [file('roster.csv', MB)] } })).toBe(
      false,
    );
    expect(onFileAccepted).not.toHaveBeenCalled();
  });

  it('lets drag events fall through to the wrapper while disabled', () => {
    const { button } = renderZone({ disabled: true });

    expect(button.className).toContain('disabled:pointer-events-none');
    expect(button.parentElement?.className).toContain('cursor-not-allowed');
  });

  it('leaves drops on the error below an enabled zone alone', () => {
    const { button, onFileAccepted } = renderZone({ error: 'Server said no' });
    const alert = screen.getByRole('alert');

    const dataTransfer = { dropEffect: 'copy', files: [] };
    expect(fireEvent.dragOver(alert, { dataTransfer })).toBe(true);
    expect(dataTransfer.dropEffect).toBe('copy');
    expect(fireEvent.drop(alert, { dataTransfer: { files: [file('roster.csv', MB)] } })).toBe(true);
    expect(onFileAccepted).not.toHaveBeenCalled();
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

  it('treats */* and * as any file', () => {
    expect(matchesAccept(file('a.pdf', 1, 'application/pdf'), ['*/*'])).toBe(true);
    expect(matchesAccept(file('a', 1), ['*'])).toBe(true);
  });

  it('ignores empty entries instead of matching files with no MIME type', () => {
    expect(matchesAccept(file('a.pdf', 1), [''])).toBe(true);
    expect(matchesAccept(file('a.pdf', 1), ['', ' ', '.csv'])).toBe(false);
    expect(matchesAccept(file('a.csv', 1), ['', '.csv'])).toBe(true);
  });

  it('matches extensions in any case', () => {
    expect(matchesAccept(file('roster.csv', 1), ['.CSV'])).toBe(true);
    expect(matchesAccept(file('ROSTER.Xlsx', 1), ['.xlsx'])).toBe(true);
  });
});
