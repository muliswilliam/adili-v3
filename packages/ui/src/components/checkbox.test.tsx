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

  it('marks the group invalid and links the error to it', () => {
    render(
      <CheckboxGroup legend="Officer categories" error="Select at least one category">
        <CheckboxItem label="State officers" />
      </CheckboxGroup>,
    );

    const error = screen.getByText('Select at least one category').closest('p');
    const group = screen.getByRole('group', { name: 'Officer categories' });
    expect(group.getAttribute('aria-describedby')).toBe(error?.id);
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is not marked invalid without an error', () => {
    render(
      <CheckboxGroup legend="Officer categories" hint="Pick any that apply">
        <CheckboxItem label="State officers" />
      </CheckboxGroup>,
    );

    const group = screen.getByRole('group', { name: 'Officer categories' });
    expect(group.getAttribute('aria-invalid')).toBeNull();
    expect(group.getAttribute('aria-describedby')).toBe(screen.getByText('Pick any that apply').id);
  });

  it("keeps the group's own aria-describedby alongside the hint and error", () => {
    render(
      <CheckboxGroup
        legend="Officer categories"
        hint="Pick any that apply"
        error="Select at least one category"
        aria-describedby="policy-note"
      >
        <CheckboxItem label="State officers" />
      </CheckboxGroup>,
    );

    const hint = screen.getByText('Pick any that apply');
    const error = screen.getByText('Select at least one category').closest('p');
    expect(
      screen.getByRole('group', { name: 'Officer categories' }).getAttribute('aria-describedby'),
    ).toBe(`policy-note ${hint.id} ${error?.id}`);
  });
});

describe('CheckboxItem', () => {
  it("keeps the checkbox's own aria-describedby alongside the hint", () => {
    render(
      <CheckboxItem
        label="Public officers"
        hint="Excludes state officers"
        aria-describedby="policy-note"
      />,
    );

    expect(
      screen.getByRole('checkbox', { name: 'Public officers' }).getAttribute('aria-describedby'),
    ).toBe(`policy-note ${screen.getByText('Excludes state officers').id}`);
  });

  it('dims its label and shows a not-allowed cursor when disabled', () => {
    render(<CheckboxItem label="State officers" disabled />);

    const checkbox = screen.getByRole('checkbox', { name: 'State officers' });
    expect(checkbox.hasAttribute('disabled')).toBe(true);
    const label = screen.getByText('State officers');
    expect(label.className).toContain('opacity-50');
    expect(label.className).toContain('cursor-not-allowed');
    expect(label.className).not.toContain('cursor-pointer');
  });

  it('keeps a pointer cursor on its label when enabled', () => {
    render(<CheckboxItem label="State officers" />);

    const label = screen.getByText('State officers');
    expect(label.className).toContain('cursor-pointer');
    expect(label.className).not.toContain('opacity-50');
  });
});
