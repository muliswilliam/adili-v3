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

function boxValues() {
  return screen.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value);
}

function paste(position: number, text: string) {
  fireEvent.paste(box(position), { clipboardData: { getData: () => text } });
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

  it('clears only the focused box on Backspace, without shifting later digits', () => {
    const onChange = vi.fn();
    render(<ControlledOtp value="123456" onChange={onChange} />);

    box(3).focus();
    fireEvent.keyDown(box(3), { key: 'Backspace' });

    expect(boxValues()).toEqual(['1', '2', '', '4', '5', '6']);
    expect(onChange).toHaveBeenLastCalledWith('12456');
    expect(document.activeElement).toBe(box(3));

    fireEvent.change(box(3), { target: { value: '9' } });

    expect(boxValues()).toEqual(['1', '2', '9', '4', '5', '6']);
    expect(onChange).toHaveBeenLastCalledWith('129456');
    expect(document.activeElement).toBe(box(4));
  });

  it('moves back and clears the previous box on Backspace in an empty box among filled ones', () => {
    render(<ControlledOtp value="123456" />);

    box(3).focus();
    fireEvent.keyDown(box(3), { key: 'Backspace' });
    fireEvent.keyDown(box(3), { key: 'Backspace' });

    expect(boxValues()).toEqual(['1', '', '', '4', '5', '6']);
    expect(document.activeElement).toBe(box(2));
  });

  it('does nothing on Backspace in an empty first box', () => {
    const onChange = vi.fn();
    render(<ControlledOtp onChange={onChange} />);

    box(1).focus();
    fireEvent.keyDown(box(1), { key: 'Backspace' });

    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(box(1));
  });

  it('clears only the focused box on Delete', () => {
    render(<ControlledOtp value="123456" />);

    box(2).focus();
    fireEvent.keyDown(box(2), { key: 'Delete' });

    expect(boxValues()).toEqual(['1', '', '3', '4', '5', '6']);
    expect(document.activeElement).toBe(box(2));
  });

  it('overwrites a filled box when a digit is typed into it', () => {
    const onChange = vi.fn();
    render(<ControlledOtp value="123456" onChange={onChange} />);

    // The caret sits after the old digit, so the box briefly holds both.
    fireEvent.change(box(4), { target: { value: '47' } });

    expect(onChange).toHaveBeenLastCalledWith('123756');
    expect(document.activeElement).toBe(box(5));
  });

  it('does not complete again when a digit of a full code is replaced', () => {
    const onComplete = vi.fn();
    render(<ControlledOtp value="123456" onComplete={onComplete} />);

    fireEvent.change(box(4), { target: { value: '7' } });

    expect(onComplete).not.toHaveBeenCalled();
  });

  it('completes again once a cleared box is filled back in', () => {
    const onComplete = vi.fn();
    render(<ControlledOtp value="123456" onComplete={onComplete} />);

    box(4).focus();
    fireEvent.keyDown(box(4), { key: 'Backspace' });
    expect(onComplete).not.toHaveBeenCalled();

    fireEvent.change(box(4), { target: { value: '7' } });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123756');
  });

  it('rejects a paste with more digits than boxes', () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    render(<ControlledOtp onChange={onChange} onComplete={onComplete} />);

    paste(1, '0712 345 678');
    paste(1, '1234567');

    expect(onChange).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(boxValues()).toEqual(['', '', '', '', '', '']);
  });

  it('rejects autofill with more digits than boxes', () => {
    const onComplete = vi.fn();
    render(<ControlledOtp onComplete={onComplete} />);

    fireEvent.change(box(1), { target: { value: '1234567' } });

    expect(onComplete).not.toHaveBeenCalled();
    expect(boxValues()).toEqual(['', '', '', '', '', '']);
  });

  it('completes on a full paste even when the code was already full', () => {
    const onComplete = vi.fn();
    render(<ControlledOtp value="111111" onComplete={onComplete} />);

    paste(4, '123456');

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(boxValues()).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('fills from the focused box on a short paste without completing', () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    render(<ControlledOtp value="1" onChange={onChange} onComplete={onComplete} />);

    paste(2, '234');

    expect(boxValues()).toEqual(['1', '2', '3', '4', '', '']);
    expect(onChange).toHaveBeenCalledWith('1234');
    expect(onComplete).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(box(5));
  });

  it('completes when a short paste fills the last empty boxes', () => {
    const onComplete = vi.fn();
    render(<ControlledOtp value="123" onComplete={onComplete} />);

    paste(4, '456');

    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('ignores a paste with no digits', () => {
    const onChange = vi.fn();
    render(<ControlledOtp onChange={onChange} />);

    paste(1, 'code');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves between boxes with the arrow keys, Home and End', () => {
    render(<ControlledOtp value="123" />);

    box(2).focus();
    fireEvent.keyDown(box(2), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(box(3));
    fireEvent.keyDown(box(3), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(box(4));
    // Not past the first empty box after the code.
    fireEvent.keyDown(box(4), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(box(4));
    fireEvent.keyDown(box(4), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(box(3));
    fireEvent.keyDown(box(3), { key: 'Home' });
    expect(document.activeElement).toBe(box(1));
    fireEvent.keyDown(box(1), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(box(1));
    fireEvent.keyDown(box(1), { key: 'End' });
    expect(document.activeElement).toBe(box(4));
  });

  it('stays on the last box with End and ArrowRight when the code is full', () => {
    render(<ControlledOtp value="123456" />);

    box(1).focus();
    fireEvent.keyDown(box(1), { key: 'End' });
    expect(document.activeElement).toBe(box(6));
    fireEvent.keyDown(box(6), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(box(6));
  });

  it('follows a value reset from outside', () => {
    const { rerender } = render(
      <OtpInput label="Verification code" value="123456" onChange={vi.fn()} />,
    );
    expect(boxValues()).toEqual(['1', '2', '3', '4', '5', '6']);

    rerender(<OtpInput label="Verification code" value="" onChange={vi.fn()} />);

    expect(boxValues()).toEqual(['', '', '', '', '', '']);
  });

  it('shows empty, partial and full codes', () => {
    const { rerender } = render(<OtpInput label="Code" value="" onChange={vi.fn()} />);
    expect(boxValues()).toEqual(['', '', '', '', '', '']);

    rerender(<OtpInput label="Code" value="48" onChange={vi.fn()} />);
    expect(boxValues()).toEqual(['4', '8', '', '', '', '']);

    rerender(<OtpInput label="Code" value="482913" onChange={vi.fn()} />);
    expect(boxValues()).toEqual(['4', '8', '2', '9', '1', '3']);
  });

  it('describes the group with its hint', () => {
    render(<ControlledOtp hint="Check your SMS." />);

    const hint = screen.getByText('Check your SMS.');
    expect(
      screen.getByRole('group', { name: 'Verification code' }).getAttribute('aria-describedby'),
    ).toBe(hint.id);
  });

  it('focuses the first box when asked', () => {
    render(<ControlledOtp autoFocus />);

    expect(document.activeElement).toBe(box(1));
  });

  it('sends a click past the last digit to the next empty box', () => {
    render(<ControlledOtp value="12" />);

    fireEvent.mouseDown(box(5));

    expect(document.activeElement).toBe(box(3));
  });

  it('sends a click on an empty box past the first gap to that gap, but lets filled boxes be clicked', () => {
    render(<ControlledOtp value="123456" />);

    fireEvent.keyDown(box(2), { key: 'Delete' });
    fireEvent.keyDown(box(5), { key: 'Delete' });
    box(1).focus();

    expect(fireEvent.mouseDown(box(6))).toBe(true);
    expect(fireEvent.mouseDown(box(5))).toBe(false);
    expect(document.activeElement).toBe(box(2));
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
    render(<ControlledOtp disabled value="123456" />);

    for (const input of screen.getAllByRole('textbox')) {
      expect((input as HTMLInputElement).disabled).toBe(true);
    }
    expect(boxValues()).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('describes the group with the hint and the error together', () => {
    render(<ControlledOtp hint="Check your SMS." error="That code has expired." />);

    const group = screen.getByRole('group', { name: 'Verification code' });
    expect(group.getAttribute('aria-describedby')).toBe(
      `${screen.getByText('Check your SMS.').id} ${screen.getByRole('alert').id}`,
    );
  });

  it('posts the whole code under one name for plain forms', () => {
    const { container } = render(<ControlledOtp name="otp" value="4821" />);

    const hidden = container.querySelector<HTMLInputElement>('input[type="hidden"][name="otp"]');
    expect(hidden?.value).toBe('4821');
  });
});
