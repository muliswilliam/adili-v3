import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AssigneeChip, initialsOf } from './assignee-chip';

const FAITH = { subject: 'faith', name: 'Faith Achieng' };
const PETER = { subject: 'peter', name: 'Peter Mwangi Kariuki' };

describe('initialsOf', () => {
  it('takes the first and last names, or one for a single name', () => {
    expect(initialsOf('Faith Achieng')).toBe('FA');
    expect(initialsOf('Peter Mwangi Kariuki')).toBe('PK');
    expect(initialsOf('  halima  ')).toBe('H');
    expect(initialsOf('')).toBe('');
  });
});

describe('AssigneeChip', () => {
  it('shows another officer by initials and name', () => {
    const { container } = render(<AssigneeChip assignee={PETER} viewerSubject="faith" />);

    const chip = container.firstElementChild as HTMLElement;
    expect(chip.textContent).toBe('PKPeter Mwangi Kariuki');
    expect(chip.getAttribute('data-assignee')).toBe('other');
    expect(chip.querySelector('[aria-hidden="true"]')?.textContent).toBe('PK');
  });

  it('marks the signed-in officer', () => {
    const { container } = render(<AssigneeChip assignee={FAITH} viewerSubject="faith" />);

    const chip = container.firstElementChild as HTMLElement;
    expect(chip.textContent).toBe('FAFaith Achieng (you)');
    expect(chip.getAttribute('data-assignee')).toBe('me');
    expect(chip.querySelector('[data-me]')).not.toBeNull();
  });

  it('reads "You" when compact, keeping the full name for hover and screen readers', () => {
    const { container } = render(<AssigneeChip assignee={FAITH} viewerSubject="faith" compact />);

    const chip = container.firstElementChild as HTMLElement;
    expect(chip.getAttribute('title')).toBe('Faith Achieng');
    expect(screen.getByText('You').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('Faith Achieng (you)').className).toContain('sr-only');
  });

  it('shows another officer in full when compact', () => {
    render(<AssigneeChip assignee={PETER} viewerSubject="faith" compact />);

    expect(screen.getByText('Peter Mwangi Kariuki')).toBeTruthy();
  });

  it('is nobody without a viewer', () => {
    const { container } = render(<AssigneeChip assignee={FAITH} />);

    expect(container.firstElementChild?.getAttribute('data-assignee')).toBe('other');
  });

  it('says when nobody holds the case', () => {
    const { container } = render(<AssigneeChip assignee={null} viewerSubject="faith" />);

    expect(container.firstElementChild?.textContent).toBe('Unassigned');
    expect(container.firstElementChild?.getAttribute('data-assignee')).toBe('none');
  });
});
