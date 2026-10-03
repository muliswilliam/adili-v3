import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { itemAnchorId, sectionAnchorId } from '../lib/declaration-summary';
import { DeclarationSummary } from './declaration-summary';
import { BUILDING_ID, SPOUSE_KEY, VEHICLE_ID, WANJIKU_DECLARATION } from './fixtures/declaration';

/** The element with this id; the test fails when there is none. */
function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error('No element ' + id);
  return element;
}

describe('DeclarationSummary', () => {
  it('reads in First Schedule order', () => {
    render(<DeclarationSummary document={WANJIKU_DECLARATION} version={2} />);

    const headings = screen.getAllByRole('heading', { level: 3 }).map((each) => each.textContent);
    expect(headings).toEqual([
      '1-5Personal and employment details',
      '6Spouses',
      '7Dependent children under 18',
      '8Financial statementsas at 1 Nov 2025',
      '9Other information',
      'Attachments2',
    ]);
    expect(screen.getAllByRole('heading', { level: 4 }).map((each) => each.textContent)).toContain(
      'David Kamau',
    );
    expect(
      screen.getByText('Solemn declaration made online on 12 Apr 2026, 12:14 (version 2).'),
    ).toBeTruthy();
  });

  it("N7: keeps a section's extras beside its heading, out of the heading's name", () => {
    render(
      <DeclarationSummary
        document={WANJIKU_DECLARATION}
        sectionExtras={(key) => (key === 'household' ? <button type="button">Pin</button> : null)}
      />,
    );

    const heading = screen.getByRole('heading', { level: 3, name: '6Spouses' });
    const pin = screen.getByRole('button', { name: 'Pin' });
    expect(heading.contains(pin)).toBe(false);
    expect(heading.parentElement?.contains(pin)).toBe(true);
  });

  it('totals each person and the household in KES', () => {
    render(<DeclarationSummary document={WANJIKU_DECLARATION} />);

    const total = screen.getByRole('rowheader', { name: 'Total' }).closest('tr') as HTMLElement;
    expect(
      within(total)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['7,300,000', '29,255,000', '7,680,000']);
  });

  it('labels each total with its column, which a narrow card shows in place of the header row', () => {
    render(<DeclarationSummary document={WANJIKU_DECLARATION} />);

    const total = screen.getByRole('rowheader', { name: 'Total' }).closest('tr') as HTMLElement;
    expect(
      within(total)
        .getAllByRole('cell')
        .map((cell) => cell.dataset.label),
    ).toEqual(['Income', 'Assets', 'Liabilities']);
  });

  it('lists each item with its type, description, value and change tag, and nil categories', () => {
    render(<DeclarationSummary document={WANJIKU_DECLARATION} />);

    const vehicle = byId(itemAnchorId(VEHICLE_ID));
    expect(vehicle.textContent).toContain('Vehicle');
    expect(vehicle.textContent).toContain('Toyota Prado, KDH 120J · Nairobi City · Sole');
    expect(vehicle.textContent).toContain('Marked as changed');
    expect(vehicle.textContent).toContain('KES 5,200,000');

    const amani = byId(sectionAnchorId('statement:child:0192f1a0-5a11-7000-8000-00000000d201'));
    expect(within(amani).getAllByText('Nil declared')).toHaveLength(3);
  });

  it('highlights the item a reviewer was sent to and adds the host’s controls', () => {
    render(
      <DeclarationSummary
        document={WANJIKU_DECLARATION}
        highlight={BUILDING_ID}
        itemExtras={({ item }) =>
          item.id === BUILDING_ID ? <button type="button">2 indicators</button> : null
        }
      />,
    );

    const building = byId(itemAnchorId(BUILDING_ID));
    expect(building.dataset.highlighted).toBe('true');
    expect(within(building).getByRole('button', { name: '2 indicators' })).toBeTruthy();
    expect(document.querySelectorAll('[data-highlighted]')).toHaveLength(1);
  });

  it('highlights a whole statement for a flag on a section', () => {
    render(
      <DeclarationSummary document={WANJIKU_DECLARATION} highlight={'statement:' + SPOUSE_KEY} />,
    );

    expect(byId(sectionAnchorId('statement:' + SPOUSE_KEY)).dataset.highlighted).toBe('true');
  });

  it('downloads attachments from the item and the list, showing where each stands', async () => {
    const onAttachment = vi.fn();
    render(
      <DeclarationSummary
        document={WANJIKU_DECLARATION}
        onAttachment={onAttachment}
        attachmentState={(uploadId) =>
          uploadId === '0192f1a0-5a11-7000-8000-00000000e102' ? 'done' : 'idle'
        }
      />,
    );

    const buttons = screen.getAllByRole('button', { name: 'Download Title deed LR 12715-482.pdf' });
    expect(buttons).toHaveLength(2);
    const [first] = buttons;
    if (!first) throw new Error('No download button');
    await userEvent.click(first);
    expect(onAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'Title deed LR 12715-482.pdf' }),
    );
    expect(
      screen.getAllByRole('button', { name: 'Download Valuation report Syokimau 2025.pdf' })[1]
        ?.textContent,
    ).toBe('Download again');
  });

  it('lists attachments by name only when nothing can download them', () => {
    render(<DeclarationSummary document={WANJIKU_DECLARATION} />);

    expect(screen.queryByRole('button', { name: /^Download/ })).toBeNull();
    expect(screen.getAllByText('Title deed LR 12715-482.pdf').length).toBeGreaterThan(0);
  });

  it('writes out other information', () => {
    render(<DeclarationSummary document={WANJIKU_DECLARATION} />);

    const other = byId(sectionAnchorId('other'));
    expect(other.textContent).toContain(
      'Wanjiku Njeri Kamau · Toyota Prado, KDH 120J: value changed · Valued lower after two years of use.',
    );
    expect(other.textContent).toContain('Kenya Institute of Supplies Management · Society');
  });
});
