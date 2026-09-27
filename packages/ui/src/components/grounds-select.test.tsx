import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type Ground, GroundsSelect, regulation24Grounds } from './grounds-select';

function renderSelect(props: Partial<Parameters<typeof GroundsSelect>[0]> = {}) {
  const onChange = vi.fn<(grounds: Ground[]) => void>();
  render(<GroundsSelect value={[]} onChange={onChange} {...props} />);
  return onChange;
}

describe('GroundsSelect', () => {
  it('lists every Regulation 24 ground under a legend, with the hint read first', () => {
    renderSelect();

    const group = screen.getByRole('group', { name: 'Regulation 24 grounds' });
    expect(group.getAttribute('aria-describedby')).toBe(
      screen.getByText(/Required for a partial grant or a denial/).id,
    );
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
  });

  it('names each ground briefly and describes it with the regulation text', () => {
    renderSelect();

    const ground = screen.getByRole('checkbox', { name: 'Against public interest' });
    const description = document.getElementById(ground.getAttribute('aria-describedby') ?? '');
    expect(description?.tagName).toBe('Q');
    expect(description?.textContent).toBe(regulation24Grounds['public-interest'].text);
    expect(description?.textContent).toMatch(/^\(a\) the disclosure/);
  });

  it('adds and removes grounds in the order of the regulation', () => {
    const onChange = renderSelect({ value: ['not-objectives'] });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Against public interest' }));
    expect(onChange).toHaveBeenLastCalledWith(['public-interest', 'not-objectives']);

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Does not promote the objectives of the Act' }),
    );
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('shows the chosen grounds as checked', () => {
    renderSelect({ value: ['frivolous-vexatious'] });

    expect(
      screen.getByRole('checkbox', { name: 'Frivolous, vexatious or scandalous' }),
    ).toHaveProperty('checked', true);
    expect(
      screen.getByRole('checkbox', { name: 'Prejudice to a proceeding or investigation' }),
    ).toHaveProperty('checked', false);
  });

  it('toggles from anywhere on the card', () => {
    const onChange = renderSelect();

    fireEvent.click(screen.getByText(regulation24Grounds['prejudice-proceeding'].text));

    expect(onChange).toHaveBeenLastCalledWith(['prejudice-proceeding']);
  });

  it('marks the group invalid and announces the error', () => {
    renderSelect({ error: 'Choose at least one ground for a partial grant or a denial.' });

    const group = screen.getByRole('group', { name: 'Regulation 24 grounds' });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Choose at least one ground for a partial grant or a denial.');
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(group.getAttribute('aria-describedby')?.split(' ')).toContain(alert.id);
  });

  it('disables every ground when disabled', () => {
    renderSelect({ disabled: true });

    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toHaveProperty('disabled', true);
    }
  });
});
