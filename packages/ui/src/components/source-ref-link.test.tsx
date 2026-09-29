import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  type SourceRef,
  SourceRefLink,
  sourceRefFromSearch,
  sourceRefKind,
  sourceRefToSearch,
} from './source-ref-link';

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

describe('sourceRefKind', () => {
  it('points at the most specific part the ref names', () => {
    expect(sourceRefKind(HOUSE)).toBe('item');
    expect(sourceRefKind({ ...HOUSE, fieldPath: '/assets/items/0/value' })).toBe('item');
    expect(sourceRefKind(SPOUSE)).toBe('person');
    expect(sourceRefKind(DESIGNATION)).toBe('field');
    expect(sourceRefKind(BIO)).toBe('section');
    expect(sourceRefKind(NONE)).toBeNull();
  });
});

describe('sourceRefToSearch and sourceRefFromSearch', () => {
  it('write only the parts that are set, in a fixed order', () => {
    expect(sourceRefToSearch(HOUSE)).toBe(
      'section=assets&person=declarant&item=7d3f2a10-4b8e-4c51-9a37-0e6f1c2b9d44',
    );
    expect(sourceRefToSearch(DESIGNATION)).toBe('section=bio&field=%2Fpersonal%2Fdesignation');
    expect(sourceRefToSearch(NONE)).toBe('');
  });

  it('read back what they wrote', () => {
    for (const ref of [HOUSE, SPOUSE, DESIGNATION, BIO, NONE]) {
      expect(sourceRefFromSearch(sourceRefToSearch(ref))).toEqual(ref);
    }
    expect(sourceRefFromSearch('?section=bio&tab=summary')).toEqual(BIO);
    expect(sourceRefFromSearch('section=bio&person=')).toEqual(BIO);
    expect(sourceRefFromSearch(new URLSearchParams('person=spouse-1'))).toEqual({
      ...NONE,
      personKey: 'spouse-1',
    });
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
    expect(link.getAttribute('data-kind')).toBe('item');

    fireEvent.click(link);

    expect(onOpen).toHaveBeenCalledWith(HOUSE);
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

  it('marks what kind of target it opens', () => {
    render(
      <>
        <SourceRefLink onOpen={vi.fn()} sourceRef={SPOUSE} label="Amani · statement" />
        <SourceRefLink onOpen={vi.fn()} sourceRef={DESIGNATION} label="Designation" />
        <SourceRefLink onOpen={vi.fn()} sourceRef={BIO} label="Personal and employment details" />
      </>,
    );

    expect(screen.getAllByRole('button').map((button) => button.getAttribute('data-kind'))).toEqual(
      ['person', 'field', 'section'],
    );
  });

  it('is plain text when the ref points at nothing', () => {
    const onOpen = vi.fn();
    render(<SourceRefLink sourceRef={NONE} label="Unknown source" onOpen={onOpen} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Unknown source')).toBeDefined();
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
