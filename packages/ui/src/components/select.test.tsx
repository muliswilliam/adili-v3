import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { FormField } from './form-field';
import { Select, SelectItem } from './select';

// jsdom lacks the pointer capture and scrolling APIs Radix Select calls.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

function StateFilter({
  onValueChange = vi.fn(),
  error,
}: {
  onValueChange?: (v: string) => void;
  error?: string;
}) {
  return (
    <FormField label="State" error={error}>
      <Select placeholder="All states" onValueChange={onValueChange}>
        <SelectItem value="not-onboarded">Not onboarded</SelectItem>
        <SelectItem value="onboarded">Onboarded</SelectItem>
      </Select>
    </FormField>
  );
}

describe('Select', () => {
  it('is labelled by its form field and shows the placeholder', () => {
    render(<StateFilter />);

    const trigger = screen.getByRole('combobox', { name: 'State' });
    expect(trigger.textContent).toContain('All states');
  });

  it('marks the trigger invalid when the field has an error', () => {
    render(<StateFilter error="Choose a state" />);

    const trigger = screen.getByRole('combobox', { name: 'State' });
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    expect(trigger.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  });

  it('opens from the keyboard and picks an option', () => {
    const onValueChange = vi.fn();
    render(<StateFilter onValueChange={onValueChange} />);

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'State' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'Onboarded' }));

    expect(onValueChange).toHaveBeenCalledWith('onboarded');
    expect(screen.getByRole('combobox', { name: 'State' }).textContent).toContain('Onboarded');
  });
});
