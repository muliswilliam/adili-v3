import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Checkbox, CheckboxGroup, CheckboxItem } from './checkbox';

describe('Checkbox', () => {
  it('renders a native checkbox that toggles', async () => {
    const user = userEvent.setup();
    render(<Checkbox aria-label="Select all" />);

    const checkbox = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select all' });
    expect(checkbox.tagName).toBe('INPUT');
    await user.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  it('toggles from its label and is described by its description', async () => {
    const user = userEvent.setup();
    render(
      <CheckboxItem
        name="categories"
        value="act-s32-a"
        label="State officers"
        description="Act, section 32(a)"
      />,
    );

    const checkbox = screen.getByRole<HTMLInputElement>('checkbox', { name: 'State officers' });
    expect(checkbox.getAttribute('aria-describedby')).toBe(
      screen.getByText('Act, section 32(a)').id,
    );
    await user.click(screen.getByText('State officers'));
    expect(checkbox.checked).toBe(true);
  });
});

describe('CheckboxGroup', () => {
  it('groups items under a legend with hint and error', () => {
    render(
      <CheckboxGroup
        legend="Categories of officers"
        hint="Which public officers this Commission is responsible for."
        error="Choose at least one category."
      >
        <CheckboxItem name="categories" value="a" label="State officers" />
        <CheckboxItem name="categories" value="b" label="Public officers" />
      </CheckboxGroup>,
    );

    const group = screen.getByRole('group', { name: 'Categories of officers' });
    const hint = screen.getByText('Which public officers this Commission is responsible for.');
    const error = screen.getByRole('alert');

    expect(group.tagName).toBe('FIELDSET');
    expect(error.textContent).toBe('Choose at least one category.');
    expect(group.getAttribute('aria-describedby')).toBe(`${hint.id} ${error.id}`);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });
});
