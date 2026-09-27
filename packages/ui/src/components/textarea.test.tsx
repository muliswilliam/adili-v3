import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Textarea } from './textarea';

describe('Textarea', () => {
  it('renders a native textarea that accepts input', () => {
    render(<Textarea aria-label="Reason" />);

    const textarea = screen.getByRole('textbox', { name: 'Reason' });
    expect(textarea.tagName).toBe('TEXTAREA');
    fireEvent.change(textarea, { target: { value: 'Duplicate declaration' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('Duplicate declaration');
  });

  it('merges a caller class with its own styles', () => {
    render(<Textarea aria-label="Reason" className="min-h-40" />);

    const textarea = screen.getByRole('textbox', { name: 'Reason' });
    expect(textarea.className).toContain('min-h-40');
    expect(textarea.className).not.toContain('min-h-[110px]');
    expect(textarea.className).toContain('shadow-control');
  });

  it('can be disabled', () => {
    render(<Textarea aria-label="Reason" disabled />);

    expect(screen.getByRole('textbox', { name: 'Reason' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows the invalid style when marked aria-invalid', () => {
    render(<Textarea aria-label="Reason" aria-invalid />);

    const textarea = screen.getByRole('textbox', { name: 'Reason' });
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(textarea.className).toContain('aria-invalid:shadow-control-error');
  });
});
