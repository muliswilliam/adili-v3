import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AttachmentList, type AttachmentListItem, formatFileSize } from './attachment-list';
import { MenuItem, MenuNote } from './menu';

const everyState: AttachmentListItem[] = [
  { id: '1', name: 'bank-statement-aug-2026.pdf', status: 'uploading', progress: 45 },
  { id: '2', name: 'payslip-aug-2026.pdf', status: 'scanning' },
  { id: '3', name: 'title-deed-block-7-1234.pdf', status: 'linked', size: 1843200 },
  { id: '4', name: 'scan-0012.pdf', status: 'infected' },
  { id: '5', name: 'valuation-report.docx', status: 'rejected-type' },
  { id: '6', name: 'IMG_20260912_101512.heic', status: 'rejected-size' },
  { id: '7', name: 'logbook-KDA123X.jpg', status: 'failed' },
];

/** Opens an attachment's action menu the way a keyboard user does (Radix opens on pointerdown or keys, not click). */
function openMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

function row(name: string) {
  const item = screen.getByText(name).closest('li');
  if (!item) throw new Error(`No row for ${name}`);
  return within(item);
}

describe('formatFileSize', () => {
  it('prints megabytes to one place, kilobytes whole and bytes under a kilobyte', () => {
    expect(formatFileSize(1843200)).toBe('1.8 MB');
    expect(formatFileSize(245760)).toBe('240 KB');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1023)).toBe('1023 bytes');
    expect(formatFileSize(266)).toBe('266 bytes');
    expect(formatFileSize(1)).toBe('1 byte');
  });
});

describe('AttachmentList', () => {
  it('renders every state in text', () => {
    render(
      <AttachmentList
        label="Documents for this asset"
        attachments={everyState}
        onRemove={vi.fn()}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(
      within(screen.getByRole('list', { name: 'Documents for this asset' })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(7);
    const progress = row('bank-statement-aug-2026.pdf').getByRole('progressbar', {
      name: 'Uploading bank-statement-aug-2026.pdf',
    });
    expect(progress.getAttribute('aria-valuenow')).toBe('45');
    expect(row('payslip-aug-2026.pdf').getByText('Checking the file for viruses…')).toBeDefined();
    expect(row('title-deed-block-7-1234.pdf').getByText('1.8 MB · Attached')).toBeDefined();
    expect(
      row('scan-0012.pdf').getByText('This file failed the security scan and was not attached.'),
    ).toBeDefined();
    expect(
      row('valuation-report.docx').getByText(/This file type cannot be attached/),
    ).toBeDefined();
    expect(row('IMG_20260912_101512.heic').getByText(/larger than 20 MB/)).toBeDefined();
    expect(row('logbook-KDA123X.jpg').getByText(/The upload did not finish/)).toBeDefined();
  });

  it('names each action after its file and offers only what fits the state', () => {
    render(
      <AttachmentList
        label="Documents"
        attachments={everyState}
        onRemove={vi.fn()}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(row('bank-statement-aug-2026.pdf').queryAllByRole('button')).toHaveLength(0);
    expect(row('payslip-aug-2026.pdf').queryAllByRole('button')).toHaveLength(0);
    expect(
      row('title-deed-block-7-1234.pdf').getByRole('button', {
        name: 'Remove title-deed-block-7-1234.pdf',
      }),
    ).toBeDefined();
    expect(
      row('scan-0012.pdf').getByRole('button', { name: 'Dismiss scan-0012.pdf' }),
    ).toBeDefined();
    expect(
      row('logbook-KDA123X.jpg').getByRole('button', { name: 'Try again: logbook-KDA123X.jpg' }),
    ).toBeDefined();
  });

  it('asks before removing a linked file', () => {
    const onRemove = vi.fn();
    render(<AttachmentList label="Documents" attachments={everyState} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove title-deed-block-7-1234.pdf' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove title-deed-block-7-1234.pdf?' });
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove document' }));

    expect(onRemove).toHaveBeenCalledWith(everyState[2]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("puts a linked file's actions in a menu, with Remove still confirmed", async () => {
    const onRemove = vi.fn();
    const onRead = vi.fn();
    render(
      <AttachmentList
        label="Documents"
        attachments={everyState}
        onRemove={onRemove}
        menuItems={(attachment) =>
          attachment.name.startsWith('title-deed') ? (
            <MenuItem
              onSelect={() => {
                onRead(attachment);
              }}
            >
              Read into the form
            </MenuItem>
          ) : null
        }
      />,
    );

    expect(screen.queryByRole('button', { name: 'Remove title-deed-block-7-1234.pdf' })).toBeNull();
    const trigger = screen.getByRole('button', {
      name: 'Actions for title-deed-block-7-1234.pdf',
    });
    openMenu(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Read into the form' }));
    await waitFor(() => {
      expect(onRead).toHaveBeenCalledWith(everyState[2]);
    });

    openMenu(trigger);
    expect(screen.getAllByRole('menuitem').map((entry) => entry.textContent)).toEqual([
      'Read into the form',
      'Remove',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove title-deed-block-7-1234.pdf?',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove document' }));
    expect(onRemove).toHaveBeenCalledWith(everyState[2]);
  });

  it('names the menu with other copy, and can hold only a note', () => {
    render(
      <AttachmentList
        label="Documents"
        attachments={everyState}
        onRemove={vi.fn()}
        menuItems={() => <MenuNote>Read into the form: not enabled for your Commission</MenuNote>}
        messages={{ actions: (name) => `Vitendo vya ${name}` }}
      />,
    );

    openMenu(screen.getByRole('button', { name: 'Vitendo vya title-deed-block-7-1234.pdf' }));
    expect(screen.getAllByRole('menuitem').map((entry) => entry.textContent)).toEqual([
      'Read into the form: not enabled for your Commission',
      'Remove',
    ]);
  });

  it('keeps the remove button when the menu has no entries for a file', () => {
    render(
      <AttachmentList
        label="Documents"
        attachments={everyState}
        onRemove={vi.fn()}
        menuItems={() => null}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Remove title-deed-block-7-1234.pdf' }),
    ).toBeDefined();
  });

  it('keeps the file when the user cancels', () => {
    const onRemove = vi.fn();
    render(<AttachmentList label="Documents" attachments={everyState} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove title-deed-block-7-1234.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onRemove).not.toHaveBeenCalled();
  });

  it('dismisses a problem file and retries a failed one', () => {
    const onDismiss = vi.fn();
    const onRetry = vi.fn();
    render(
      <AttachmentList
        label="Documents"
        attachments={everyState}
        onDismiss={onDismiss}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss scan-0012.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again: logbook-KDA123X.jpg' }));

    expect(onDismiss).toHaveBeenCalledWith(everyState[3]);
    expect(onRetry).toHaveBeenCalledWith(everyState[6]);
  });

  it('announces a file finishing, but not the files already there', () => {
    const uploading: AttachmentListItem = { id: '1', name: 'payslip.pdf', status: 'scanning' };
    const { rerender } = render(<AttachmentList label="Documents" attachments={[uploading]} />);
    expect(screen.getByRole('status').textContent).toBe('');

    rerender(
      <AttachmentList
        label="Documents"
        attachments={[{ ...uploading, status: 'linked', size: 2048 }]}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('payslip.pdf attached.');

    rerender(
      <AttachmentList label="Documents" attachments={[{ ...uploading, status: 'infected' }]} />,
    );
    expect(screen.getByRole('status').textContent).toBe(
      'payslip.pdf: This file failed the security scan and was not attached.',
    );
  });

  it('adds a picked file and says why it was rejected in the browser', () => {
    const onAdd = vi.fn();
    render(
      <AttachmentList
        label="Documents"
        attachments={[]}
        onAdd={onAdd}
        accept={['.pdf', 'image/jpeg']}
        maxSize={1024}
        addHint="PDF or JPEG, up to 1 KB."
      />,
    );

    const add = screen.getByRole('button', { name: 'Add document' });
    expect(add.getAttribute('aria-describedby')).toBe(
      screen.getByText('PDF or JPEG, up to 1 KB.').id,
    );
    expect(screen.queryByRole('list')).toBeNull();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('No file input');

    const pdf = new File(['x'], 'deed.pdf', { type: 'application/pdf' });
    const doc = new File(['x'], 'report.docx');
    const big = new File(['x'.repeat(2048)], 'big.pdf', { type: 'application/pdf' });
    for (const file of [pdf, doc, big]) fireEvent.change(input, { target: { files: [file] } });

    expect(onAdd.mock.calls).toEqual([
      [pdf, null],
      [doc, 'type'],
      [big, 'size'],
    ]);
  });
});
