import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DateInput } from './date-input';
import { FormField } from './form-field';

function StatementDate({
  initial = null,
  onValueChange = vi.fn(),
  disabled,
}: {
  initial?: string | null;
  onValueChange?: (value: string | null, details: { text: string; invalid: boolean }) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <FormField label="Date of birth" hint="For example, 27/03/1985">
      <DateInput
        value={value}
        today="2026-09-26"
        disabled={disabled}
        onValueChange={(next, details) => {
          setValue(next);
          onValueChange(next, details);
        }}
      />
    </FormField>
  );
}

function input() {
  return screen.getByRole<HTMLInputElement>('textbox', { name: 'Date of birth' });
}

function toggle() {
  return screen.getByRole('button', { name: 'Choose a date from the calendar' });
}

describe('DateInput', () => {
  it('is labelled and described by its field, with the picker closed', () => {
    render(<StatementDate />);

    expect(input().getAttribute('aria-describedby')).toBe(
      screen.getByText('For example, 27/03/1985').id,
    );
    expect(input().getAttribute('placeholder')).toBe('DD/MM/YYYY');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('S19: accepts a typed DD/MM/YYYY date without the picker', () => {
    const onValueChange = vi.fn();
    render(<StatementDate onValueChange={onValueChange} />);

    fireEvent.change(input(), { target: { value: '26092026' } });

    expect(input().value).toBe('26/09/2026');
    expect(onValueChange).toHaveBeenLastCalledWith('2026-09-26', {
      text: '26/09/2026',
      invalid: false,
    });
  });

  it('S19: does not accept an impossible date', () => {
    const onValueChange = vi.fn();
    render(<StatementDate onValueChange={onValueChange} />);

    fireEvent.change(input(), { target: { value: '31/02/2026' } });

    expect(input().value).toBe('31/02/2026');
    expect(onValueChange).toHaveBeenLastCalledWith(null, { text: '31/02/2026', invalid: true });
  });

  it('treats a cleared field as empty, not invalid', () => {
    const onValueChange = vi.fn();
    render(<StatementDate initial="1985-03-27" onValueChange={onValueChange} />);
    expect(input().value).toBe('27/03/1985');

    fireEvent.change(input(), { target: { value: '' } });

    expect(onValueChange).toHaveBeenLastCalledWith(null, { text: '', invalid: false });
  });

  it('opens the picker on the chosen month and picks a day', () => {
    const onValueChange = vi.fn();
    render(<StatementDate initial="1985-03-27" onValueChange={onValueChange} />);

    fireEvent.click(toggle());

    const picker = screen.getByRole('dialog', { name: 'Choose a date' });
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Month' }).value).toBe('3');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Year' }).value).toBe('1985');
    const chosen = screen.getByRole('button', { name: '27 March 1985' });
    expect(chosen.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(chosen);

    fireEvent.click(screen.getByRole('button', { name: '5 March 1985' }));

    expect(onValueChange).toHaveBeenLastCalledWith('1985-03-05', {
      text: '05/03/1985',
      invalid: false,
    });
    expect(input().value).toBe('05/03/1985');
    expect(picker.isConnected).toBe(false);
    expect(document.activeElement).toBe(input());
  });

  it('opens on today when empty, marks today and steps between months', () => {
    render(<StatementDate />);

    fireEvent.click(toggle());
    expect(
      screen.getByRole('button', { name: '26 September 2026' }).getAttribute('aria-current'),
    ).toBe('date');

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('button', { name: '31 October 2026' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.queryByRole('button', { name: '31 August 2026' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: '31 September 2026' })).toBeNull();
  });

  it('closes on Escape and returns focus to its button', () => {
    render(<StatementDate />);

    fireEvent.click(toggle());
    fireEvent.keyDown(screen.getByRole('button', { name: '26 September 2026' }), {
      key: 'Escape',
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it('cannot open the picker when disabled', () => {
    render(<StatementDate disabled />);

    expect(input().disabled).toBe(true);
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
  });
});
