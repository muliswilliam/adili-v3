import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  declarationReferenceParts,
  ReferenceChip,
  type ReferenceChipProps,
} from './reference-chip';
import { ToastProvider } from './toast';

const REFERENCE = 'DCB-TSC-2027-0012345-K';
// As the portal passes them: names from the numbering scheme registry and the directory.
const parts = declarationReferenceParts({
  type: 'Biennial declaration',
  issuer: 'Teachers Service Commission',
});

function renderChip(props: Partial<ReferenceChipProps> = {}) {
  return render(
    <ToastProvider>
      <ReferenceChip reference={REFERENCE} parts={parts} {...props} />
    </ToastProvider>,
  );
}

const explain = () => screen.getByRole('button', { name: 'What does this reference mean?' });

describe('ReferenceChip', () => {
  it('shows the reference with buttons to copy and explain it', () => {
    renderChip();

    expect(screen.getByText(REFERENCE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy reference number' })).toBeTruthy();
    expect(explain().getAttribute('aria-expanded')).toBe('false');
  });

  it('breaks DCB-TSC-2027-0012345-K into type, issuer, year, sequence and check with labels', async () => {
    const user = userEvent.setup();
    renderChip();

    await user.click(explain());

    const breakdown = screen.getByRole('dialog', { name: 'How to read this reference' });
    expect(explain().getAttribute('aria-expanded')).toBe('true');
    const rows = within(breakdown)
      .getAllByRole('definition')
      .map((meaning) => [meaning.previousElementSibling?.textContent, meaning.textContent]);
    expect(rows).toEqual([
      ['DCBType', 'Biennial declaration'],
      ['TSCIssuer', 'Teachers Service Commission'],
      ['2027Year', 'Year of the statement date'],
      ['0012345Sequence', 'Number within that Commission and year'],
      ['KCheck', 'Catches typing mistakes'],
    ]);
  });

  it('closes the breakdown with Esc and returns focus to its button', async () => {
    const user = userEvent.setup();
    renderChip();
    await user.click(explain());

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(explain());
  });

  it('opens from the keyboard', async () => {
    const user = userEvent.setup();
    renderChip();

    explain().focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('dialog', { name: 'How to read this reference' })).toBeTruthy();
  });

  it('offers no breakdown without parts, or when they do not fit the reference', () => {
    const { rerender } = renderChip({ parts: undefined });
    expect(screen.queryByRole('button', { name: 'What does this reference mean?' })).toBeNull();

    rerender(
      <ToastProvider>
        <ReferenceChip reference="OFR-0482913-L" parts={parts} />
      </ToastProvider>,
    );
    expect(screen.queryByRole('button', { name: 'What does this reference mean?' })).toBeNull();
  });

  it('can leave out the copy button', () => {
    renderChip({ copyable: false });

    expect(screen.queryByRole('button', { name: 'Copy reference number' })).toBeNull();
  });

  it('takes other wording, for the chip and the declaration parts', async () => {
    const user = userEvent.setup();
    renderChip({
      messages: { explain: 'Nambari hii inamaanisha nini?', heading: 'Jinsi ya kusoma' },
      parts: declarationReferenceParts(
        { type: 'Tamko la kila miaka miwili', issuer: 'Tume ya Huduma kwa Walimu' },
        { year: 'Mwaka' },
      ),
    });

    await user.click(screen.getByRole('button', { name: 'Nambari hii inamaanisha nini?' }));

    const breakdown = screen.getByRole('dialog', { name: 'Jinsi ya kusoma' });
    expect(within(breakdown).getByText('Mwaka')).toBeTruthy();
    expect(within(breakdown).getByText('Tume ya Huduma kwa Walimu')).toBeTruthy();
  });

  it('comes large for the one reference a page is about', () => {
    renderChip({ size: 'lg' });

    expect(screen.getByText(REFERENCE).className).toContain('text-[17px]');
  });
});
