import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Tooltip, TooltipProvider } from './tooltip';

function ImportButton() {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip content="Wait for the current import to finish">
        <span tabIndex={0} data-testid="trigger">
          <button type="button" disabled>
            Import roster
          </button>
        </span>
      </Tooltip>
    </TooltipProvider>
  );
}

describe('Tooltip', () => {
  it('shows on keyboard focus and describes its trigger', () => {
    render(<ImportButton />);
    const trigger = screen.getByTestId('trigger');

    fireEvent.focus(trigger);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe('Wait for the current import to finish');
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);
  });

  it('closes on Escape', () => {
    render(<ImportButton />);
    const trigger = screen.getByTestId('trigger');

    fireEvent.focus(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('works without a TooltipProvider', () => {
    render(
      <Tooltip content="Only admins can export">
        <button type="button">Export</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Export' });

    fireEvent.focus(trigger);

    expect(screen.getByRole('tooltip').textContent).toBe('Only admins can export');
  });
});
