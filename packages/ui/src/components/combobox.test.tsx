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
  it('shows supporting option text and reports opening and selection closure', () => {
    const onOpenChange = vi.fn();
    const onValueChange = vi.fn();
    render(
      <Combobox
        aria-label="Commission"
        options={[
          {
            value: 'tsc',
            label: 'Teachers Service Commission',
            secondaryText: 'Roster not imported yet',
          },
        ]}
        value={null}
        onValueChange={onValueChange}
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Commission' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    const option = screen.getByRole('option', { name: /Teachers Service Commission/ });
    expect(option.textContent).toContain('Roster not imported yet');
    fireEvent.click(option);
    expect(onValueChange).toHaveBeenCalledWith('tsc');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
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

  it('keeps a value whose options have not loaded when it is focused and blurred', () => {
    const onValueChange = vi.fn();
    render(
      <Combobox aria-label="Commission" options={[]} value="tsc" onValueChange={onValueChange} />,
    );

    const field = screen.getByRole('combobox', { name: 'Commission' });
    fireEvent.focus(field);
    fireEvent.click(field);
    fireEvent.blur(field);

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('shows the chosen option once async options load', () => {
    const { rerender } = render(
      <Combobox aria-label="Commission" options={[]} value="tsc" onValueChange={vi.fn()} />,
    );
    const field = screen.getByRole('combobox', { name: 'Commission' });
    expect((field as HTMLInputElement).value).toBe('');

    rerender(
      <Combobox
        aria-label="Commission"
        options={commissions}
        value="tsc"
        onValueChange={vi.fn()}
      />,
    );

    expect((field as HTMLInputElement).value).toBe('Teachers Service Commission');
  });

  it('shows selectedOption while the options are loading', () => {
    const onValueChange = vi.fn();
    render(
      <Combobox
        aria-label="Commission"
        options={[]}
        value="tsc"
        selectedOption={{ value: 'tsc', label: 'Teachers Service Commission' }}
        onValueChange={onValueChange}
      />,
    );

    const field = screen.getByRole('combobox', { name: 'Commission' });
    expect((field as HTMLInputElement).value).toBe('Teachers Service Commission');

    fireEvent.change(field, { target: { value: 'Teach' } });
    fireEvent.blur(field);

    expect((field as HTMLInputElement).value).toBe('Teachers Service Commission');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('keeps the choice when the text is cleared and typed back before blur', () => {
    const onValueChange = vi.fn();
    render(<CommissionPicker initial="psc" onValueChange={onValueChange} />);

    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.change(input(), { target: { value: 'Pub' } });
    fireEvent.blur(input());

    expect(onValueChange).not.toHaveBeenCalled();
    expect((input() as HTMLInputElement).value).toBe('Public Service Commission');
  });
});
