// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CodeForm } from './code-form';

function renderForm(props: { initialCode?: string; pending?: boolean } = {}) {
  const onSubmit = vi.fn();
  render(<CodeForm onSubmit={onSubmit} {...props} />);
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Verification code' });
  return { onSubmit, input };
}

function check() {
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
}

describe('CodeForm', () => {
  it('shapes what is typed into the printed groups', () => {
    const { input } = renderForm();

    fireEvent.change(input, { target: { value: 'adl 7q4k m2xr o' } });

    expect(input.value).toBe('7Q4K-M2XR-0');
    expect(input.getAttribute('placeholder')).toBe('7Q4K-M2XR-9HTC-W3NB-5FJD-K6RT-8P');
    expect(screen.getByText('Starts with ADL. Not case sensitive.').id).toBe(
      input.getAttribute('aria-describedby'),
    );
  });

  it('submits the normalised code', () => {
    const { input, onSubmit } = renderForm();

    fireEvent.change(input, { target: { value: '7q4k-m2xr-9htc-w3nb-5fjd-k6rt-8p' } });
    check();

    expect(onSubmit).toHaveBeenCalledWith('ADL-7Q4K-M2XR-9HTC-W3NB-5FJD-K6RT-8P');
  });

  it('asks for the code when there is none', () => {
    const { input, onSubmit } = renderForm();

    check();

    expect(screen.getByRole('alert').textContent).toBe(
      'Enter the verification code printed under the QR code.',
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a code that is too short, and clears the error on the next keystroke', () => {
    const { input, onSubmit } = renderForm();

    fireEvent.change(input, { target: { value: '7Q4K' } });
    check();

    expect(screen.getByRole('alert').textContent).toBe(
      'Enter the code exactly as printed under the QR code, starting with ADL.',
    );
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '7Q4KM' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('starts from a code to correct', () => {
    const { input } = renderForm({ initialCode: 'ADL-2222-3333-4444-5555-6666-7777-88' });

    expect(input.value).toBe('2222-3333-4444-5555-6666-7777-88');
  });

  it('shows the lookup on its way', () => {
    renderForm({ pending: true });

    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Checking' });
    expect(button.disabled).toBe(true);
  });
});
