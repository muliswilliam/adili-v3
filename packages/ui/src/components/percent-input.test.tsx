import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FormField } from './form-field';
import { PercentInput } from './percent-input';

function ShareField({
  initial = null,
  onValueChange = vi.fn(),
  error,
}: {
  initial?: number | null;
  onValueChange?: (value: number | null) => void;
  error?: string;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <FormField label="Your share" error={error}>
      <PercentInput
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onValueChange(next);
        }}
      />
    </FormField>
  );
}

function field() {
  return screen.getByRole<HTMLInputElement>('textbox', { name: 'Your share' });
}

describe('PercentInput', () => {
  it('shows the value with a % that screen readers skip', () => {
    render(<ShareField initial={50} />);

    expect(field().value).toBe('50');
    expect(field().getAttribute('inputmode')).toBe('numeric');
    const sign = screen.getByText('%');
    expect(sign.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps only the digits, and reports an empty field as null', () => {
    const onValueChange = vi.fn();
    render(<ShareField onValueChange={onValueChange} />);

    fireEvent.change(field(), { target: { value: '4a0' } });
    expect(onValueChange).toHaveBeenLastCalledWith(40);
    expect(field().value).toBe('40');

    fireEvent.change(field(), { target: { value: '' } });
    expect(onValueChange).toHaveBeenLastCalledWith(null);
    expect(field().value).toBe('');
  });

  it('takes three digits at most', () => {
    render(<ShareField />);

    expect(field().maxLength).toBe(3);
  });

  it('works inside a FormField', () => {
    render(<ShareField error="Enter your share, from 1 to 100" />);

    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Enter your share, from 1 to 100')).toBeDefined();
  });
});
