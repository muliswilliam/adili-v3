import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MatchTable, type MatchTableRow } from './match-table';

const rows: MatchTableRow[] = [
  {
    id: 'parcel-1',
    record: 'NYERI/MUKURWE-INI/1187',
    recordDetail: 'Nyeri · 0.2 ha · freehold',
    relation: 'matched',
    declared: 'Land',
    declaredDetail: '0.5 acre plot, NYERI/MUKURWE-INI/1187',
    action: <a href="#item-1">Go to item</a>,
  },
  {
    id: 'parcel-2',
    record: 'KAJIADO/KITENGELA/48213',
    recordDetail: 'Kajiado · 0.05 ha · freehold',
    relation: 'not-declared',
  },
  {
    id: 'company',
    record: 'BN-4K7Q2P',
    recordDetail: 'BRS has no company with this registration number',
    relation: 'not-in-registry',
    declared: 'Other',
  },
];

describe('MatchTable', () => {
  it('is a table named after the registry, with a column for the record and one for the item', () => {
    render(<MatchTable system="ArdhiSasa" rows={rows} />);

    const table = screen.getByRole('table', {
      name: 'ArdhiSasa records beside the declared items',
    });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['ArdhiSasa record', 'Declared item']);
  });

  it('names each row after its registry record with a row header', () => {
    render(<MatchTable system="ArdhiSasa" rows={rows} />);

    expect(screen.getAllByRole('rowheader')).toHaveLength(3);
    const header = screen.getByRole('rowheader', { name: /NYERI\/MUKURWE-INI\/1187/ });
    expect(header.getAttribute('scope')).toBe('row');
    expect(within(header).getByText('Nyeri · 0.2 ha · freehold')).toBeTruthy();
  });

  it('shows each relation as a word in a badge', () => {
    render(<MatchTable system="ArdhiSasa" rows={rows} />);

    const relation = (record: RegExp, word: string) =>
      within(screen.getByRole('row', { name: record })).getByText(word).className;
    expect(relation(/NYERI/, 'Matched')).toContain('text-success');
    expect(relation(/KAJIADO/, 'Not declared')).toContain('text-warning');
    expect(relation(/BN-4K7Q2P/, 'Not in registry')).toContain('text-warning');
  });

  it('pairs a matched record with the declared item and its action', () => {
    render(<MatchTable system="ArdhiSasa" rows={rows} />);

    const row = screen.getByRole('row', { name: /NYERI/ });
    expect(within(row).getByText('Land')).toBeTruthy();
    expect(within(row).getByText('0.5 acre plot, NYERI/MUKURWE-INI/1187')).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'Go to item' })).toBeTruthy();
  });

  it('says there is no record for what the registry does not hold', () => {
    render(<MatchTable system="BRS" rows={rows} />);

    expect(screen.getByRole('rowheader', { name: /No record for BN-4K7Q2P/ })).toBeTruthy();
  });

  it('says the registry has no records when there are no rows', () => {
    render(<MatchTable system="NTSA" rows={[]} />);

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('NTSA has no records for this person.')).toBeTruthy();
  });

  it('compares values without relations under another column name', () => {
    render(
      <MatchTable
        system="KRA"
        messages={{ declaredColumn: 'Compared with the declaration' }}
        rows={[{ id: 'pin', record: 'PIN', declared: 'On record' }]}
      />,
    );

    expect(
      screen.getByRole('columnheader', { name: 'Compared with the declaration' }),
    ).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'PIN' })).toBeTruthy();
    expect(screen.queryByText('Matched')).toBeNull();
  });

  it('takes other wording', () => {
    render(
      <MatchTable
        system="NTSA"
        rows={rows.slice(1, 2)}
        messages={{
          recordColumn: (system) => `Rekodi ya ${system}`,
          relations: { 'not-declared': 'Haijatangazwa' },
        }}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'Rekodi ya NTSA' })).toBeTruthy();
    expect(screen.getByText('Haijatangazwa')).toBeTruthy();
  });
});
