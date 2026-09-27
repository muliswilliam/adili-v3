import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SegmentedChoice } from './segmented-choice';

const marital = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'separated', label: 'Separated' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
];

function MaritalStatus({
  initial = null,
  onValueChange = vi.fn(),
  error,
  disabled,
}: {
  initial?: string | null;
  onValueChange?: (value: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <SegmentedChoice
      legend="Marital status"
      hint="On the statement date"
      options={marital}
      value={value}
      error={error}
      disabled={disabled}
      onValueChange={(next) => {
        setValue(next);
        onValueChange(next);
      }}
    />
  );
}

describe('SegmentedChoice', () => {
  it('is a group of radios named by its legend and described by its hint', () => {
    render(<MaritalStatus />);

    const group = screen.getByRole('group', { name: 'Marital status' });
    expect(group.getAttribute('aria-describedby')).toBe(
      screen.getByText('On the statement date').id,
    );
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getAllByRole<HTMLInputElement>('radio').some((radio) => radio.checked)).toBe(
      false,
    );
  });

  it('shows the chosen option and reports a new choice', () => {
    const onValueChange = vi.fn();
    render(<MaritalStatus initial="single" onValueChange={onValueChange} />);

    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Single' }).checked).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'Married' }));

    expect(onValueChange).toHaveBeenCalledWith('married');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Married' }).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Single' }).checked).toBe(false);
  });

  it('announces an error and links it to the group', () => {
    render(<MaritalStatus error="Choose your marital status." />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Choose your marital status.');
    expect(
      screen.getByRole('group', { name: 'Marital status' }).getAttribute('aria-describedby'),
    ).toContain(alert.id);
    expect(screen.getByRole('radio', { name: 'Single' }).getAttribute('aria-invalid')).toBe('true');
  });

  it('disables every option when disabled', () => {
    render(<MaritalStatus disabled />);

    for (const radio of screen.getAllByRole<HTMLInputElement>('radio')) {
      expect(radio.matches(':disabled')).toBe(true);
    }
  });
});
