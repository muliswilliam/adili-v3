import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from './input';
import { Textarea } from './textarea';

// The read-only fill keys off this selector; jsdom can check which elements it matches.
const readOnlyFill = '[&[readonly]:not(:disabled)]:bg-muted';
const readOnlySelector = '[readonly]:not(:disabled)';

interface ControlProps {
  readOnly?: boolean;
  disabled?: boolean;
}

describe.each([
  ['Input', (props: ControlProps) => <Input aria-label="Name" {...props} />],
  ['Textarea', (props: ControlProps) => <Textarea aria-label="Name" {...props} />],
])('%s', (_name, renderControl) => {
  it('fills a read-only control with muted', () => {
    render(renderControl({ readOnly: true }));

    const control = screen.getByRole('textbox', { name: 'Name' });
    expect(control.className).toContain(readOnlyFill);
    expect(control.matches(readOnlySelector)).toBe(true);
  });

  it('styles a disabled control as disabled, not read-only', () => {
    render(renderControl({ readOnly: true, disabled: true }));

    const control = screen.getByRole('textbox', { name: 'Name' });
    expect(control.className).toContain('disabled:text-muted-foreground');
    expect(control.matches(readOnlySelector)).toBe(false);
  });

  it('leaves an editable control on the control fill', () => {
    render(renderControl({}));

    const control = screen.getByRole('textbox', { name: 'Name' });
    expect(control.className).toContain('bg-control');
    expect(control.matches(readOnlySelector)).toBe(false);
  });
});

describe('Input', () => {
  it('does not give checkboxes, radios or file inputs the read-only fill', () => {
    const { container } = render(
      <>
        <Input type="checkbox" />
        <Input type="radio" />
        <Input type="file" />
      </>,
    );

    const inputs = [...container.querySelectorAll('input')];
    expect(inputs).toHaveLength(3);
    for (const input of inputs) {
      expect(input.matches(':read-only')).toBe(true);
      expect(input.matches(readOnlySelector)).toBe(false);
      expect(input.className).not.toMatch(/(^| )read-only:/);
    }
  });
});
