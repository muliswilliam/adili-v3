import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Textarea } from './textarea';

describe('Textarea', () => {
  it('renders a native multi-line text box that accepts input', async () => {
    const user = userEvent.setup();
    render(<Textarea aria-label="Notes" />);

    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Notes' });
    expect(textarea.tagName).toBe('TEXTAREA');
    await user.type(textarea, 'First line{enter}Second line');
    expect(textarea.value).toBe('First line\nSecond line');
  });

  it('styles the invalid state from aria-invalid', () => {
    render(<Textarea aria-label="Notes" aria-invalid />);

    expect(screen.getByRole('textbox', { name: 'Notes' }).className).toContain(
      'aria-invalid:border-destructive',
    );
  });
});
