import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Combobox, type ComboboxOption } from './combobox';
import { FormField } from './form-field';

const commissions: ComboboxOption[] = [
  { value: 'psc', label: 'Public Service Commission', description: 'PSC' },
  { value: 'tsc', label: 'Teachers Service Commission', description: 'TSC' },
  { value: 'jsc', label: 'Judicial Service Commission', description: 'JSC' },
];

// jsdom does not implement scrolling.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
});

function CommissionPicker({
  onValueChange = vi.fn(),
  initial = null,
}: {
  onValueChange?: (value: string | null) => void;
  initial?: string | null;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <FormField label="Your Responsible Commission" hint="The Commission you declare to">
      <Combobox
        options={commissions}
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onValueChange(next);
        }}
      />
    </FormField>
  );
}

function input() {
  return screen.getByRole('combobox', { name: 'Your Responsible Commission' });
}

describe('Combobox', () => {
  it('is labelled and described by its form field and starts closed', () => {
    render(<CommissionPicker />);

    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().getAttribute('aria-describedby')).toBe(
      screen.getByText('The Commission you declare to').id,
    );
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('filters by name or code as the user types', () => {
    render(<CommissionPicker />);

    fireEvent.change(input(), { target: { value: 'tsc' } });

    expect(input().getAttribute('aria-expanded')).toBe('true');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain('Teachers Service Commission');
  });

  it('picks an option with the arrow keys and Enter', () => {
    const onValueChange = vi.fn();
    render(<CommissionPicker onValueChange={onValueChange} />);

    fireEvent.change(input(), { target: { value: 'service' } });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input().getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: /Teachers/ }).id,
    );
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(onValueChange).toHaveBeenCalledWith('tsc');
    expect((input() as HTMLInputElement).value).toBe('Teachers Service Commission');
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('picks an option with a click', () => {
    const onValueChange = vi.fn();
    render(<CommissionPicker onValueChange={onValueChange} />);

    fireEvent.click(input());
    fireEvent.click(screen.getByRole('option', { name: /Judicial/ }));

    expect(onValueChange).toHaveBeenCalledWith('jsc');
  });

  it('says so when nothing matches', () => {
    render(<CommissionPicker />);

    fireEvent.change(input(), { target: { value: 'ministry' } });

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No matches')).toBeDefined();
  });

  it('closes on Escape and reverts half-typed text on blur', () => {
    render(<CommissionPicker initial="psc" />);

    fireEvent.change(input(), { target: { value: 'Teach' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input().getAttribute('aria-expanded')).toBe('false');

    fireEvent.blur(input());
    expect((input() as HTMLInputElement).value).toBe('Public Service Commission');
  });

  it('clears the choice when the text is cleared', () => {
    const onValueChange = vi.fn();
    render(<CommissionPicker initial="psc" onValueChange={onValueChange} />);

    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.blur(input());

    expect(onValueChange).toHaveBeenCalledWith(null);
  });
});
