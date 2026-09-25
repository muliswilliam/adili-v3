import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Checkbox, CheckboxGroup, CheckboxItem } from './checkbox';

describe('Checkbox', () => {
  it('renders a native checkbox that toggles', () => {
    render(<Checkbox aria-label="Select all" />);

    const checkbox = screen.getByRole('checkbox', { name: 'Select all' });
    expect(checkbox.tagName).toBe('INPUT');
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
  });
});

describe('CheckboxGroup', () => {
  it('groups labelled checkboxes under a legend', () => {
    render(
      <CheckboxGroup legend="Officer categories">
        <CheckboxItem name="categories" value="state" label="State officers" />
        <CheckboxItem
          name="categories"
          value="public"
          label="Public officers"
          hint="Excludes state officers"
        />
      </CheckboxGroup>,
    );

    const group = screen.getByRole('group', { name: 'Officer categories' });
    expect(group.tagName).toBe('FIELDSET');
    const publicOfficers = screen.getByRole('checkbox', { name: 'Public officers' });
    expect(publicOfficers.getAttribute('aria-describedby')).toBe(
      screen.getByText('Excludes state officers').id,
    );
    expect(screen.getByRole('checkbox', { name: 'State officers' })).toBeDefined();
  });

  it('announces the error and links it to the group', () => {
    render(
      <CheckboxGroup legend="Officer categories" error="Select at least one category">
        <CheckboxItem label="State officers" />
      </CheckboxGroup>,
    );

    const error = screen.getByRole('alert');
    expect(error.textContent).toBe('Select at least one category');
    expect(
      screen.getByRole('group', { name: 'Officer categories' }).getAttribute('aria-describedby'),
    ).toBe(error.id);
  });
});
