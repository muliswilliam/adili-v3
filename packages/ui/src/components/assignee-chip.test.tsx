import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AssigneeChip } from './assignee-chip';

describe('AssigneeChip', () => {
  it('shows another officer by name with their initials', () => {
    const { container } = render(<AssigneeChip name="Peter Mwangi" />);

    const chip = container.firstElementChild as HTMLElement;
    expect(chip.textContent).toBe('PMPeter Mwangi');
    expect(chip.dataset.assignee).toBe('other');
    expect(chip.querySelector('[aria-hidden="true"]')?.textContent).toBe('PM');
  });

  it('marks the signed-in user with "(you)" and the brand avatar', () => {
    const { container } = render(<AssigneeChip name="Faith Achieng" current />);

    expect(screen.getByText('(you)')).toBeTruthy();
    expect(container.querySelector('[data-current]')?.className).toContain('to-brand');
  });

  it('reads "You" in a compact chip, with the name on hover', () => {
    const { container } = render(<AssigneeChip name="Faith Achieng" current compact />);

    const chip = container.firstElementChild as HTMLElement;
    expect(chip.textContent).toBe('FAYou');
    expect(chip.title).toBe('Faith Achieng');
  });

  it('keeps the name of another officer in a compact chip', () => {
    render(<AssigneeChip name="Peter Mwangi" compact />);

    expect(screen.getByText('Peter Mwangi')).toBeTruthy();
  });

  it('says nobody holds the case', () => {
    const { container } = render(<AssigneeChip name={null} />);

    const chip = container.firstElementChild as HTMLElement;
    expect(chip.textContent).toBe('Unassigned');
    expect(chip.dataset.assignee).toBe('none');
    expect(chip.className).toContain('border-dashed');
  });

  it('takes other wording', () => {
    render(
      <>
        <AssigneeChip messages={{ unassigned: 'Hakuna' }} />
        <AssigneeChip name="Faith Achieng" current messages={{ you: '(wewe)' }} />
      </>,
    );

    expect(screen.getByText('Hakuna')).toBeTruthy();
    expect(screen.getByText('(wewe)')).toBeTruthy();
  });
});
