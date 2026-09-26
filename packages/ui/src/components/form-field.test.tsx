import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FormField } from './form-field';
import { Input } from './input';
import { Textarea } from './textarea';

describe('FormField', () => {
  it('labels the control and describes it with the hint', () => {
    render(
      <FormField label="Issuer code" hint="Three to six capital letters.">
        <Input />
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Issuer code' });
    expect(input.getAttribute('aria-describedby')).toBe(
      screen.getByText('Three to six capital letters.').id,
    );
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('marks the control invalid and announces the error', () => {
    render(
      <FormField label="Issuer code" hint="Three to six capital letters." error="Enter a code.">
        <Input />
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Issuer code' });
    const hint = screen.getByText('Three to six capital letters.');
    const error = screen.getByRole('alert');

    expect(error.textContent).toBe('Enter a code.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(`${hint.id} ${error.id}`);
  });

  it('uses the given control id and wires a textarea the same way', () => {
    render(
      <FormField label="Reason" controlId="reason" error="Give a reason." optional>
        <Textarea />
      </FormField>,
    );

    const textarea = screen.getByRole('textbox', { name: 'Reason' });
    expect(textarea.id).toBe('reason');
    expect(textarea.getAttribute('aria-describedby')).toBe('reason-error');
    expect(screen.getByText('Optional')).toBeTruthy();
  });

  it('keeps the control valid when there is no hint or error', () => {
    render(
      <FormField label="Name">
        <Input />
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });
});
