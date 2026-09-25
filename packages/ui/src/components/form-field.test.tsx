import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FormField } from './form-field';
import { Input } from './input';
import { Textarea } from './textarea';

describe('FormField', () => {
  it('labels the control and describes it with the hint', () => {
    render(
      <FormField label="Commission name" hint="As it appears in the gazette notice">
        <Input />
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Commission name' });
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe(
      screen.getByText('As it appears in the gazette notice').id,
    );
  });

  it('marks the control invalid and announces the error', () => {
    render(
      <FormField label="Reason" hint="Shown to the officer" error="Enter a reason">
        <Textarea />
      </FormField>,
    );

    const textarea = screen.getByRole('textbox', { name: 'Reason' });
    const error = screen.getByRole('alert');
    expect(error.textContent).toBe('Enter a reason');
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(textarea.getAttribute('aria-describedby')).toBe(
      `${screen.getByText('Shown to the officer').id} ${error.id}`,
    );
  });

  it('uses the given control id', () => {
    render(
      <FormField label="Email" controlId="officer-email">
        <Input type="email" />
      </FormField>,
    );

    expect(screen.getByRole('textbox', { name: 'Email' }).id).toBe('officer-email');
  });
});
