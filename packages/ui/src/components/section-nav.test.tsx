import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SectionNav, type SectionNavSection } from './section-nav';
import { SaveIndicator } from './save-indicator';

const sections: SectionNavSection[] = [
  { id: 'bio', label: 'Your details', status: 'complete' },
  { id: 'household', label: 'Spouses and children', status: 'complete' },
  {
    id: 'statements',
    label: 'Financial statements',
    status: 'incomplete',
    sections: [
      { id: 'self', label: 'You', status: 'complete' },
      { id: 'spouse-1', label: 'Mary Wanjiru Kennedy', status: 'incomplete' },
      { id: 'child-1', label: 'Faith Jeptoo Kennedy', status: 'not-started' },
    ],
  },
  { id: 'other', label: 'Other information', status: 'not-started' },
  { id: 'summary', label: 'Summary', hint: 'Check and submit' },
];

function nav() {
  return screen.getByRole('navigation', { name: 'Declaration sections' });
}

describe('SectionNav', () => {
  it('lists the sections in order with their completeness in text', () => {
    render(
      <SectionNav
        label="Declaration sections"
        sections={sections}
        current="bio"
        onSelect={vi.fn()}
      />,
    );

    const top = within(nav())
      .getAllByRole('listitem')
      .filter((item) => item.parentElement?.parentElement === nav());
    expect(top.map((item) => item.querySelector('button')?.textContent)).toEqual([
      '1Your details, Complete',
      'Spouses and children, Complete',
      '3Financial statements, Incomplete',
      '4Other information, Not started',
      '5Summary, Check and submit',
    ]);
  });

  it('marks exactly one current section', () => {
    render(
      <SectionNav
        label="Declaration sections"
        sections={sections}
        current="household"
        onSelect={vi.fn()}
      />,
    );

    const currents = nav().querySelectorAll('[aria-current]');
    expect(currents).toHaveLength(1);
    expect(currents[0]?.getAttribute('aria-current')).toBe('page');
    expect(currents[0]?.textContent).toContain('Spouses and children');
  });

  it('marks a current sub-section and gives each person its status in text', () => {
    render(
      <SectionNav
        label="Declaration sections"
        sections={sections}
        current="spouse-1"
        onSelect={vi.fn()}
      />,
    );

    const current = screen.getByRole('button', { current: 'page' });
    expect(current.textContent).toBe('Mary Wanjiru Kennedy, Incomplete');
    expect(screen.getByRole('button', { name: 'Faith Jeptoo Kennedy, Not started' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'You, Complete' })).toBeDefined();
  });

  it('reports the section the user picks', () => {
    const onSelect = vi.fn();
    render(
      <SectionNav
        label="Declaration sections"
        sections={sections}
        current="bio"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Other information/ }));
    fireEvent.click(screen.getByRole('button', { name: /Faith Jeptoo Kennedy/ }));

    expect(onSelect.mock.calls).toEqual([['other'], ['child-1']]);
  });

  it('takes custom status words and a footer', () => {
    render(
      <SectionNav
        label="Declaration sections"
        sections={sections.slice(0, 1)}
        current="bio"
        onSelect={vi.fn()}
        statusLabels={{ complete: 'Done' }}
        footer={<SaveIndicator status="saved" />}
      />,
    );

    expect(screen.getByRole('button', { name: /Your details/ }).textContent).toContain('Done');
    expect(within(nav()).getByRole('status').textContent).toBe('Saved');
  });
});
