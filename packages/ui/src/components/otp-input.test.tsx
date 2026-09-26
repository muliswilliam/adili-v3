import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { OtpInput, type OtpInputProps } from './otp-input';

function ControlledOtp(props: Partial<OtpInputProps>) {
  const [value, setValue] = useState(props.value ?? '');
  return (
    <OtpInput
      label="Verification code"
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        props.onChange?.(next);
      }}
    />
  );
}

function box(position: number) {
  return screen.getByRole('textbox', { name: `Digit ${String(position)} of 6` });
}

describe('OtpInput', () => {
  it('renders six labelled boxes in a named group', () => {
    render(<ControlledOtp />);

    expect(screen.getByRole('group', { name: 'Verification code' })).toBeDefined();
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
    expect(box(1).getAttribute('autocomplete')).toBe('one-time-code');
    expect(box(1).getAttribute('inputmode')).toBe('numeric');
  });

  it('advances as digits are typed and completes once with the whole code', () => {
    const onComplete = vi.fn();
    render(<ControlledOtp onComplete={onComplete} />);

    '123456'.split('').forEach((digit, index) => {
      fireEvent.change(box(index + 1), { target: { value: digit } });
      if (index < 5) expect(document.activeElement).toBe(box(index + 2));
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('fills every box from one paste with a single onChange', () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    render(<ControlledOtp onChange={onChange} onComplete={onComplete} />);

    fireEvent.paste(box(3), { clipboardData: { getData: () => '12 34 56' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(
      screen.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value),
    ).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('fills every box when the phone autofills the code into the first box', () => {
    const onComplete = vi.fn();
    render(<ControlledOtp onComplete={onComplete} />);

    fireEvent.change(box(1), { target: { value: '654321' } });

    expect(onComplete).toHaveBeenCalledWith('654321');
  });

  it('ignores letters', () => {
    const onChange = vi.fn();
    render(<ControlledOtp onChange={onChange} />);

    fireEvent.change(box(1), { target: { value: 'a' } });

    expect(onChange).not.toHaveBeenCalled();
    expect((box(1) as HTMLInputElement).value).toBe('');
  });

  it('moves back and clears the previous digit on Backspace in an empty box', () => {
    const onChange = vi.fn();
    render(<ControlledOtp value="12" onChange={onChange} />);

    box(3).focus();
    fireEvent.keyDown(box(3), { key: 'Backspace' });

    expect(onChange).toHaveBeenLastCalledWith('1');
    expect(document.activeElement).toBe(box(2));
  });

  it('sends a click past the last digit to the next empty box', () => {
    render(<ControlledOtp value="12" />);

    fireEvent.mouseDown(box(5));

    expect(document.activeElement).toBe(box(3));
  });

  it('marks every box invalid and announces the error', () => {
    render(<ControlledOtp error="That code is wrong. You have 4 attempts left." />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('That code is wrong. You have 4 attempts left.');
    expect(
      screen.getByRole('group', { name: 'Verification code' }).getAttribute('aria-describedby'),
    ).toBe(alert.id);
    for (const input of screen.getAllByRole('textbox')) {
      expect(input.getAttribute('aria-invalid')).toBe('true');
    }
  });

  it('disables every box while verifying', () => {
    render(<ControlledOtp disabled />);

    for (const input of screen.getAllByRole('textbox')) {
      expect((input as HTMLInputElement).disabled).toBe(true);
    }
  });

  it('posts the whole code under one name for plain forms', () => {
    const { container } = render(<ControlledOtp name="otp" value="4821" />);

    const hidden = container.querySelector<HTMLInputElement>('input[type="hidden"][name="otp"]');
    expect(hidden?.value).toBe('4821');
  });
});
