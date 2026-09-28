import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Stepper } from './stepper';

const steps = [
  { id: 'template', label: 'Template' },
  { id: 'upload', label: 'Upload' },
  { id: 'check', label: 'Check' },
  { id: 'import', label: 'Import' },
];

describe('Stepper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('keeps a visible focus outline on completed steps', () => {
    render(<Stepper label="Import steps" steps={steps} current="check" onSelect={vi.fn()} />);

    const button = screen.getByRole('button', { name: /Template/ });
    expect(button.className).not.toContain('outline-none');
    expect(button.className).toContain('outline-hidden');
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

  it('keeps completed steps as text when canSelect returns false', () => {
    const onSelect = vi.fn();
    render(
      <Stepper
        label="Import steps"
        steps={steps}
        current="import"
        onSelect={onSelect}
        canSelect={() => false}
      />,
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    fireEvent.click(screen.getByText('Template'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('warns in development when current matches no step', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { rerender } = render(<Stepper label="Import steps" steps={steps} current="missing" />);
    rerender(<Stepper label="Import steps" steps={steps} current="missing" />);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('"missing"');
    const nav = screen.getByRole('navigation', { name: 'Import steps' });
    expect(nav.querySelector('[aria-current]')).toBeNull();
  });
});
