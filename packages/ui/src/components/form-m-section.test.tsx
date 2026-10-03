import type { FormMV1 } from '@adili/forms';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FormMSection } from './form-m-section';

type Section = FormMV1['partII']['initial'];

const ROWS: Section['nonFilers'] = [
  {
    obligationId: 'o-1',
    name: 'Jane Wanjiru',
    designation: 'Senior Clerical Officer',
    identifier: 'PSC/2025/0412',
    date: '2025-09-01',
    actionTaken: 'warning',
    complied: 'pending',
    remarks: 'Warning issued 12 May 2026.',
  },
  {
    obligationId: 'o-2',
    name: 'Peter Otieno',
    designation: 'Driver',
    identifier: 'PSC/2025/0533',
    date: '2025-11-14',
    actionTaken: 'none',
    complied: 'no',
  },
];

const INITIAL: Section = { expected: 50, declared: 42, notDeclared: 8, nonFilers: ROWS };

describe('FormMSection', () => {
  it('heads the section with its number and the prescribed title', () => {
    render(<FormMSection section="initial" data={INITIAL} />);

    expect(
      screen.getByRole('region', {
        name: 'Submission of initial declaration of income, assets and liabilities',
      }),
    ).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('explains the provision behind an (i) button', () => {
    render(<FormMSection section="final" data={INITIAL} />);

    expect(screen.getByRole('button', { name: 'About section 3' })).toBeTruthy();
  });

  it('shows the counts (a) to (c) in the form’s words, and the rate as text', () => {
    render(<FormMSection section="initial" data={INITIAL} />);

    expect(
      screen.getByText(
        'Number of public officers appointed within the reporting period (newly appointed officers)',
      ).parentElement?.textContent,
    ).toBe(
      '(a) Number of public officers appointed within the reporting period (newly appointed officers)50',
    );
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
    expect(screen.getByText('84%')).toBeTruthy();
  });

  it('lists the officers who did not declare in a table captioned with the section', () => {
    render(<FormMSection section="initial" data={INITIAL} />);

    const table = screen.getByRole('table', {
      name: 'Section 1(d): List of officers who did not submit initial declaration of income, assets and liabilities',
    });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    const [header, first, second] = rows.map((row) => within(row));
    expect(header?.getByText('Date of appointment')).toBeTruthy();
    expect(first?.getByText('1.')).toBeTruthy();
    expect(first?.getByText('Jane Wanjiru')).toBeTruthy();
    expect(first?.getByText('PSC/2025/0412')).toBeTruthy();
    expect(first?.getByText('1 Sep 2025')).toBeTruthy();
    expect(first?.getByText('Warning')).toBeTruthy();
    expect(first?.getByText('Pending')).toBeTruthy();
    expect(first?.getByText('Warning issued 12 May 2026.')).toBeTruthy();
    expect(second?.getByText('No action')).toBeTruthy();
    expect(second?.getByText('Not complied')).toBeTruthy();
    expect(second?.getByText('-')).toBeTruthy();
  });

  it('heads a final section’s date column with the date of exit', () => {
    render(<FormMSection section="final" data={INITIAL} />);

    expect(screen.getByRole('columnheader', { name: 'Date of exit' })).toBeTruthy();
  });

  it('labels each remark by its officer when remarks are editable, and reports edits', () => {
    const onRemarkChange = vi.fn();
    render(<FormMSection section="initial" data={INITIAL} onRemarkChange={onRemarkChange} />);

    const field = screen.getByRole('textbox', { name: 'Remarks for Jane Wanjiru' });
    expect((field as HTMLTextAreaElement).value).toBe('Warning issued 12 May 2026.');
    expect(field.getAttribute('maxlength')).toBe('500');
    expect(screen.getByRole('textbox', { name: 'Remarks for Peter Otieno' })).toBeTruthy();

    fireEvent.change(field, { target: { value: 'Warning issued; responded late.' } });

    expect(onRemarkChange).toHaveBeenCalledWith(ROWS[0], 'Warning issued; responded late.');
  });

  it('says who edited a remark', () => {
    render(
      <FormMSection
        section="initial"
        data={INITIAL}
        onRemarkChange={() => undefined}
        remarkEditedBy={(row) => (row.obligationId === 'o-1' ? 'Samuel Njoroge' : null)}
      />,
    );

    expect(screen.getByText('Edited by Samuel Njoroge')).toBeTruthy();
    expect(screen.getAllByText(/Edited by/)).toHaveLength(1);
  });

  it('says whether the remarks are saved', () => {
    const { rerender } = render(
      <FormMSection section="initial" data={INITIAL} onRemarkChange={() => undefined} />,
    );
    expect(screen.queryByRole('status')).toBeNull();

    rerender(
      <FormMSection
        section="initial"
        data={INITIAL}
        onRemarkChange={() => undefined}
        saveStatus="saving"
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Saving…');

    rerender(
      <FormMSection
        section="initial"
        data={INITIAL}
        onRemarkChange={() => undefined}
        saveStatus="saved"
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Remarks saved');
  });

  it('numbers a later page’s rows on from the earlier pages, under the caller’s pager', () => {
    render(
      <FormMSection
        section="biennial"
        data={{ ...INITIAL, nonFilers: ROWS }}
        nonFilersTotal={12}
        firstRowNumber={11}
        pagination={<nav aria-label="Pages">pager</nav>}
      />,
    );

    expect(screen.getByText('11.')).toBeTruthy();
    expect(screen.getByText('12.')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeTruthy();
  });

  it('says there is nobody to list when everyone declared', () => {
    render(
      <FormMSection
        section="initial"
        data={{ expected: 5, declared: 5, notDeclared: 0, nonFilers: [] }}
      />,
    );

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('No officers to list.')).toBeTruthy();
  });

  it('says a financial year had no biennial cycle instead of counts', () => {
    render(
      <FormMSection
        section="biennial"
        data={{ expected: 0, declared: 0, notDeclared: 0, nonFilers: [], noCycleInPeriod: true }}
      />,
    );

    expect(screen.getByText('No biennial cycle in this period.')).toBeTruthy();
    expect(screen.queryByText(/\(a\)/)).toBeNull();
  });

  it('takes other wording', () => {
    render(
      <FormMSection
        section="initial"
        data={INITIAL}
        messages={{ remarks: 'Maoni', remarksFor: (name) => `Maoni ya ${name}` }}
        onRemarkChange={() => undefined}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'Maoni' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Maoni ya Jane Wanjiru' })).toBeTruthy();
  });
});
