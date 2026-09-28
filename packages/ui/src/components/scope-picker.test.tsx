import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { formatScope, isSameScope, isScopeWithin, type Scope, ScopePicker } from './scope-picker';

const requested: Scope = {
  years: [2025, 2026],
  includeSpouses: true,
  includeChildren: false,
  sections: ['income', 'assets', 'liabilities'],
  includeClarifications: true,
};

const empty: Scope = {
  years: [],
  includeSpouses: false,
  includeChildren: false,
  sections: [],
  includeClarifications: false,
};

function renderPicker(props: Partial<Parameters<typeof ScopePicker>[0]> = {}) {
  const onChange = vi.fn<(scope: Scope) => void>();
  render(<ScopePicker value={empty} onChange={onChange} years={[2025, 2026]} {...props} />);
  return onChange;
}

describe('ScopePicker', () => {
  it('groups years, people and sections under legends', () => {
    renderPicker();

    const years = screen.getByRole('group', { name: 'Years' });
    expect(
      within(years)
        .getAllByRole('checkbox')
        .map((box) => box.getAttribute('name')),
    ).toEqual(['years', 'years']);
    const people = screen.getByRole('group', { name: 'People' });
    expect(within(people).getAllByRole('checkbox')).toEqual(
      ['The declarant', 'Spouses', 'Children', 'Clarifications'].map((name) =>
        within(people).getByRole('checkbox', { name }),
      ),
    );
    const sections = screen.getByRole('group', { name: 'Sections' });
    expect(within(sections).getAllByRole('checkbox')).toHaveLength(5);
  });

  it('always includes the declarant', () => {
    renderPicker();

    const declarant = screen.getByRole('checkbox', { name: 'The declarant' });
    expect(declarant).toHaveProperty('checked', true);
    expect(declarant.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(declarant);
    expect(declarant).toHaveProperty('checked', true);
  });

  it('adds and removes years in order', () => {
    const onChange = renderPicker({ value: { ...empty, years: [2026] } });

    fireEvent.click(screen.getByRole('checkbox', { name: '2025' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...empty, years: [2025, 2026] });

    fireEvent.click(screen.getByRole('checkbox', { name: '2026' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...empty, years: [] });
  });

  it('keeps sections in the order of the form', () => {
    const onChange = renderPicker({ value: { ...empty, sections: ['liabilities'] } });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Income' }));

    expect(onChange).toHaveBeenLastCalledWith({ ...empty, sections: ['income', 'liabilities'] });
  });

  it('includes spouses, children and clarifications', () => {
    const onChange = renderPicker();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Spouses' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...empty, includeSpouses: true });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Children' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...empty, includeChildren: true });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clarifications' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...empty, includeClarifications: true });
  });

  it('leaves clarifications out when the request cannot include them', () => {
    renderPicker({ clarifications: false });

    expect(screen.queryByRole('checkbox', { name: 'Clarifications' })).toBeNull();
  });

  it('offers only what was requested when restricted, and says why the rest is off', () => {
    const onChange = renderPicker({
      value: requested,
      years: [2024, 2025, 2026],
      restrictTo: requested,
    });

    const year2024 = screen.getByRole('checkbox', { name: '2024' });
    expect(year2024).toHaveProperty('disabled', true);
    expect(year2024.getAttribute('aria-describedby')).toBe(
      within(screen.getByRole('group', { name: 'Years' }))
        .getByText('Not requested')
        .closest('p')?.id,
    );
    expect(screen.getByRole('checkbox', { name: 'Children' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('checkbox', { name: 'Personal details' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getAllByText('Not requested')).toHaveLength(4);

    // Narrowing within the request still works.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Assets' }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...requested,
      sections: ['income', 'liabilities'],
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Spouses' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...requested, includeSpouses: false });
  });

  it('shows and keeps chosen and requested years outside the years on offer', () => {
    const onChange = renderPicker({
      value: { ...requested, years: [2025, 2026] },
      years: [2026, 2027],
      restrictTo: { ...requested, years: [2024, 2025, 2026] },
    });

    expect(
      within(screen.getByRole('group', { name: 'Years' }))
        .getAllByRole('checkbox')
        .map((box) => box.getAttribute('value')),
    ).toEqual(['2024', '2025', '2026', '2027']);
    fireEvent.click(screen.getByRole('checkbox', { name: '2024' }));

    expect(onChange).toHaveBeenLastCalledWith({ ...requested, years: [2024, 2025, 2026] });
  });

  it('lets a stray choice outside the request be unticked', () => {
    const onChange = renderPicker({
      value: { ...requested, sections: ['bio', 'income'] },
      restrictTo: requested,
    });

    const bio = screen.getByRole('checkbox', { name: 'Personal details' });
    expect(bio).toHaveProperty('disabled', false);
    fireEvent.click(bio);

    expect(onChange).toHaveBeenLastCalledWith({ ...requested, sections: ['income'] });
  });

  it('marks a group with an error invalid and announces the message', () => {
    renderPicker({
      errors: { years: 'Choose at least one year.', sections: 'Choose at least one section.' },
    });

    const years = screen.getByRole('group', { name: 'Years' });
    expect(years.getAttribute('aria-invalid')).toBe('true');
    const alerts = screen.getAllByRole('alert');
    expect(alerts.map((alert) => alert.textContent)).toEqual([
      'Choose at least one year.',
      'Choose at least one section.',
    ]);
    expect(years.getAttribute('aria-describedby')).toBe(alerts[0]?.id);
    expect(screen.getByRole('group', { name: 'People' }).getAttribute('aria-invalid')).toBeNull();
  });

  it('disables every choice when disabled', () => {
    renderPicker({ disabled: true });

    for (const box of screen.getAllByRole('checkbox')) {
      expect(box.hasAttribute('disabled') || box.getAttribute('aria-disabled') === 'true').toBe(
        true,
      );
    }
  });
});

describe('isScopeWithin', () => {
  it('accepts a narrower or equal scope', () => {
    expect(isScopeWithin(requested, requested)).toBe(true);
    expect(
      isScopeWithin(
        { ...requested, years: [2026], includeSpouses: false, sections: ['assets'] },
        requested,
      ),
    ).toBe(true);
  });

  it('rejects anything that was not requested', () => {
    expect(isScopeWithin({ ...requested, years: [2024] }, requested)).toBe(false);
    expect(isScopeWithin({ ...requested, includeChildren: true }, requested)).toBe(false);
    expect(isScopeWithin({ ...requested, sections: ['bio'] }, requested)).toBe(false);
    expect(
      isScopeWithin(
        { ...requested, includeClarifications: true },
        { ...requested, includeClarifications: false },
      ),
    ).toBe(false);
  });
});

describe('isSameScope', () => {
  it('ignores order', () => {
    expect(
      isSameScope(requested, {
        ...requested,
        years: [2026, 2025],
        sections: ['liabilities', 'income', 'assets'],
      }),
    ).toBe(true);
    expect(isSameScope(requested, { ...requested, sections: ['income'] })).toBe(false);
    expect(isSameScope(requested, { ...requested, includeClarifications: false })).toBe(false);
  });
});

describe('formatScope', () => {
  it('summarises years, people, sections and clarifications', () => {
    expect(formatScope(requested)).toBe(
      '2025, 2026 · Declarant and spouses · Income, assets, liabilities · clarifications',
    );
    expect(
      formatScope({ ...empty, years: [2026], includeChildren: true, sections: ['bio', 'other'] }),
    ).toBe('2026 · Declarant and children · Personal details, other information');
    expect(formatScope({ ...requested, includeChildren: true, includeClarifications: false })).toBe(
      '2025, 2026 · Declarant, spouses and children · Income, assets, liabilities',
    );
    expect(formatScope({ ...empty, years: [2026], sections: ['income'] })).toBe(
      '2026 · Declarant only · Income',
    );
  });
});
