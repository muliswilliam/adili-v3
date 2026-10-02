import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type SourceRef, SourceRefLink, sourceRefTarget } from './source-ref-link';

const NONE: SourceRef = { sectionKey: null, personKey: null, itemId: null, fieldPath: null };
const HOUSE: SourceRef = {
  sectionKey: 'assets',
  personKey: 'declarant',
  itemId: '7d3f2a10-4b8e-4c51-9a37-0e6f1c2b9d44',
  fieldPath: null,
};
const SPOUSE: SourceRef = { ...NONE, sectionKey: 'statement', personKey: 'spouse-1' };
const DESIGNATION: SourceRef = { ...NONE, sectionKey: 'bio', fieldPath: '/personal/designation' };
const BIO: SourceRef = { ...NONE, sectionKey: 'bio' };

describe('sourceRefTarget', () => {
  it('points at the most specific part the ref names', () => {
    expect(sourceRefTarget(HOUSE)).toBe('item');
    expect(sourceRefTarget({ ...HOUSE, fieldPath: '/assets/items/0/value' })).toBe('item');
    expect(sourceRefTarget(SPOUSE)).toBe('person');
    expect(sourceRefTarget(DESIGNATION)).toBe('field');
    expect(sourceRefTarget({ ...SPOUSE, fieldPath: '/persons/spouse-1/income' })).toBe('field');
    expect(sourceRefTarget(BIO)).toBe('section');
    expect(sourceRefTarget(NONE)).toBeNull();
  });
});

describe('SourceRefLink', () => {
  it('opens its target and announces what it opens', () => {
    const onOpen = vi.fn();
    render(
      <SourceRefLink
        sourceRef={HOUSE}
        label="4-bedroom house on LR 12715/482"
        targetLabel="Assets, Building, 4-bedroom house on LR 12715/482, Wanjiku Njeri Kamau"
        onOpen={onOpen}
      />,
    );

    const link = screen.getByRole('button', {
      name: 'Open in the declaration: Assets, Building, 4-bedroom house on LR 12715/482, Wanjiku Njeri Kamau',
    });
    expect(link.textContent).toBe('4-bedroom house on LR 12715/482');
    expect(link.getAttribute('data-target')).toBe('item');

    fireEvent.click(link);

    expect(onOpen).toHaveBeenCalledWith(HOUSE);
  });

  it('shows a detail after the label, to tell like chips apart, cut only past 45% of the chip (N26)', () => {
    render(
      <SourceRefLink
        sourceRef={HOUSE}
        label="Residential plot with two-bedroom flat, Ruaka"
        detail="Peter Mwangi Kamau"
        onOpen={vi.fn()}
      />,
    );

    const link = screen.getByRole('button', {
      name: 'Open in the declaration: Residential plot with two-bedroom flat, Ruaka',
    });
    expect(link.textContent).toBe(
      'Residential plot with two-bedroom flat, Ruaka· Peter Mwangi Kamau',
    );
    const detail = screen.getByText('· Peter Mwangi Kamau');
    expect(detail.className).toContain('shrink-0');
    // On a phone a long name is cut rather than spilling out of the chip.
    expect(detail.className).toContain('max-w-[45%]');
    expect(detail.className).toContain('truncate');
    expect(link.className).toContain('overflow-hidden');
  });

  it('names the target with the label when there is no longer description', () => {
    render(
      <SourceRefLink onOpen={vi.fn()} sourceRef={BIO} label="Personal and employment details" />,
    );

    expect(
      screen.getByRole('button', {
        name: 'Open in the declaration: Personal and employment details',
      }),
    ).toBeDefined();
  });

  it('marks what it opens', () => {
    render(
      <>
        <SourceRefLink onOpen={vi.fn()} sourceRef={SPOUSE} label="Amani · statement" />
        <SourceRefLink onOpen={vi.fn()} sourceRef={DESIGNATION} label="Designation" />
        <SourceRefLink onOpen={vi.fn()} sourceRef={BIO} label="Personal and employment details" />
      </>,
    );

    expect(
      screen.getAllByRole('button').map((button) => button.getAttribute('data-target')),
    ).toEqual(['person', 'field', 'section']);
  });

  it('is plain text when the ref points at nothing', () => {
    const onOpen = vi.fn();
    render(
      <SourceRefLink
        sourceRef={NONE}
        label="Unknown source"
        onOpen={onOpen}
        id="ref-1"
        data-testid="ref"
      />,
    );

    expect(screen.queryByRole('button')).toBeNull();
    const text = screen.getByTestId('ref');
    expect(text.textContent).toBe('Unknown source');
    expect(text.id).toBe('ref-1');
  });

  it('takes other copy', () => {
    render(
      <SourceRefLink
        onOpen={vi.fn()}
        sourceRef={DESIGNATION}
        label="Cheo"
        messages={{ openPrefix: 'Fungua kwenye tamko' }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Fungua kwenye tamko: Cheo' })).toBeDefined();
  });
});
