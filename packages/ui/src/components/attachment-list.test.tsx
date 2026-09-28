import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AttachmentList, type AttachmentListItem, formatFileSize } from './attachment-list';

const everyState: AttachmentListItem[] = [
  { id: '1', name: 'bank-statement-aug-2026.pdf', status: 'uploading', progress: 45 },
  { id: '2', name: 'payslip-aug-2026.pdf', status: 'scanning' },
  { id: '3', name: 'title-deed-block-7-1234.pdf', status: 'linked', size: 1843200 },
  { id: '4', name: 'scan-0012.pdf', status: 'infected' },
  { id: '5', name: 'valuation-report.docx', status: 'rejected-type' },
  { id: '6', name: 'IMG_20260912_101512.heic', status: 'rejected-size' },
  { id: '7', name: 'logbook-KDA123X.jpg', status: 'failed' },
];

function row(name: string) {
  const item = screen.getByText(name).closest('li');
  if (!item) throw new Error(`No row for ${name}`);
  return within(item);
}

describe('formatFileSize', () => {
  it('prints megabytes to one place and kilobytes whole', () => {
    expect(formatFileSize(1843200)).toBe('1.8 MB');
    expect(formatFileSize(245760)).toBe('240 KB');
    expect(formatFileSize(100)).toBe('1 KB');
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
