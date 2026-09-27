import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Stepper } from './stepper';

const steps = [
  { id: 'template', label: 'Template' },
  { id: 'upload', label: 'Upload' },
  { id: 'check', label: 'Check' },
  { id: 'import', label: 'Import' },
];

describe('Stepper', () => {
  it('marks the current step', () => {
    render(<Stepper label="Import steps" steps={steps} current="upload" />);

    const nav = screen.getByRole('navigation', { name: 'Import steps' });
    const current = nav.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain('Upload');
    expect(nav.querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it('lets the user go back to a completed step', () => {
    const onSelect = vi.fn();
    render(<Stepper label="Import steps" steps={steps} current="check" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /Template/ }));
    expect(onSelect).toHaveBeenCalledWith('template');
  });

  it('keeps upcoming and disabled steps out of the tab order', () => {
    render(
      <Stepper
        label="Import steps"
        steps={steps}
        current="check"
        onSelect={vi.fn()}
        canSelect={(id) => id !== 'template'}
      />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain('Upload');
    expect(screen.getByText('Import').closest('button, a, [tabindex]')).toBeNull();
    expect(screen.getByText('Template').closest('button, a, [tabindex]')).toBeNull();
  });

  it('says when the current step failed', () => {
    render(<Stepper label="Import steps" steps={steps} current="import" failed />);

    const current = screen
      .getByRole('navigation', { name: 'Import steps' })
      .querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain('Import (failed)');
  });
});
