import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FormField } from './form-field';
import { MoneyInput, type MoneyInputProps } from './money-input';

function AmountField({
  initial = null,
  onValueChange = vi.fn(),
  error,
}: {
  initial?: number | null;
  onValueChange?: MoneyInputProps['onValueChange'];
  error?: string;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <FormField label="Approximate value" hint="What it would sell for today" error={error}>
        <MoneyInput
          value={value}
          onValueChange={(cents, details) => {
            setValue(cents);
            onValueChange(cents, details);
          }}
        />
      </FormField>
      <button
        type="button"
        onClick={() => {
          setValue(null);
        }}
      >
        Reset
      </button>
    </>
  );
}

function input() {
  return screen.getByRole<HTMLInputElement>('textbox', { name: 'Approximate value' });
}

describe('MoneyInput', () => {
  it('is labelled by its field and described by the hint and the currency', () => {
    render(<AmountField />);

    const described = (input().getAttribute('aria-describedby') ?? '').split(' ');
    const texts = described.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toEqual(['What it would sell for today', 'KES']);
    expect(input().getAttribute('inputmode')).toBe('decimal');
  });

  it('S19: stores 1,250,000.50 as 125000050 cents and shows it grouped', () => {
    const onValueChange = vi.fn();
    render(<AmountField onValueChange={onValueChange} />);

    fireEvent.change(input(), { target: { value: '1250000.50' } });

    expect(input().value).toBe('1,250,000.50');
    expect(onValueChange).toHaveBeenLastCalledWith(125000050, {
      text: '1,250,000.50',
      invalid: false,
    });
  });

  it('S19: rejects a negative, keeping the minus sign so the field can say why', () => {
    const onValueChange = vi.fn();
    render(<AmountField onValueChange={onValueChange} />);

    fireEvent.change(input(), { target: { value: '-3000' } });

    expect(input().value).toBe('-3,000');
    expect(onValueChange).toHaveBeenLastCalledWith(null, {
      text: '-3,000',
      invalid: true,
      reason: 'negative',
    });
  });

  it('reports an empty field as null, not zero', () => {
    const onValueChange = vi.fn();
    render(<AmountField initial={5000} onValueChange={onValueChange} />);
    expect(input().value).toBe('50');

    fireEvent.change(input(), { target: { value: '' } });

    expect(onValueChange).toHaveBeenLastCalledWith(null, { text: '', invalid: false });
  });

  it('flags an amount too large to store', () => {
    const onValueChange = vi.fn();
    render(<AmountField onValueChange={onValueChange} />);

    fireEvent.change(input(), { target: { value: '999999999999999999' } });

    expect(onValueChange).toHaveBeenLastCalledWith(null, {
      text: '999,999,999,999,999,999',
      invalid: true,
      reason: 'too-large',
    });
  });

  it('tidies a trailing point on blur', () => {
    render(<AmountField />);

    fireEvent.change(input(), { target: { value: '1250.' } });
    fireEvent.blur(input());

    expect(input().value).toBe('1,250');
  });

  it('follows a value set from outside', () => {
    render(<AmountField initial={125000050} />);
    expect(input().value).toBe('1,250,000.50');

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(input().value).toBe('');
  });

  it('shows an error from its field', () => {
    render(<AmountField error="Enter the approximate value." />);

    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Enter the approximate value.');
  });
});
