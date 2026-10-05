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

  it('marks the control invalid and describes it with the error', () => {
    render(
      <FormField label="Reason" hint="Shown to the officer" error="Enter a reason">
        <Textarea />
      </FormField>,
    );

    const textarea = screen.getByRole('textbox', { name: 'Reason' });
    const error = screen.getByText('Enter a reason').closest('p');
    if (!error) throw new Error('error message not rendered');
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

  it('places the hint below the control in the body, with the label in the header', () => {
    const { container } = render(
      <FormField label="Reason" hint="Shown to the officer" error="Enter a reason">
        <Textarea />
      </FormField>,
    );

    const field = container.firstElementChild;
    if (!field) throw new Error('field not rendered');
    expect(field.children).toHaveLength(2);
    const [header, body] = field.children;
    expect(header?.contains(screen.getByText('Reason'))).toBe(true);
    expect(body?.children[1]).toBe(screen.getByText('Shown to the officer'));
    expect(body?.contains(screen.getByRole('textbox', { name: 'Reason' }))).toBe(true);
    expect(body?.contains(screen.getByRole('alert'))).toBe(true);
  });

  it('labels a control that brings its own id', () => {
    render(
      <FormField label="Gazette reference">
        <Input id="gazette-ref" />
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Gazette reference' });
    expect(input.id).toBe('gazette-ref');
    expect(screen.getByText('Gazette reference').getAttribute('for')).toBe('gazette-ref');
  });

  it("keeps the control's own aria-describedby alongside the hint and error", () => {
    render(
      <>
        <p id="char-count">0 of 200</p>
        <FormField label="Reason" hint="Shown to the officer" error="Enter a reason">
          <Textarea aria-describedby="char-count" />
        </FormField>
      </>,
    );

    const textarea = screen.getByRole('textbox', { name: 'Reason' });
    const hint = screen.getByText('Shown to the officer');
    const error = screen.getByText('Enter a reason').closest('p');
    expect(textarea.getAttribute('aria-describedby')).toBe(`char-count ${hint.id} ${error?.id}`);
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
  });

  it('announces the error with role alert and links it to the control', () => {
    render(
      <FormField label="Email" error="Enter an email">
        <Input />
      </FormField>,
    );

    const error = screen.getByRole('alert');
    expect(error.textContent).toBe('Enter an email');
    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});
