import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

// jsdom has no ResizeObserver; Radix measures the arrow with it.
beforeAll(() => {
  const noop = () => undefined;
  globalThis.ResizeObserver = class {
    observe = noop;
    unobserve = noop;
    disconnect = noop;
  };
});

describe('Tooltip', () => {
  it('opens on keyboard focus and describes its trigger', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>+2</span>
          </TooltipTrigger>
          <TooltipContent>Regs r.5(e), Regs r.5(f)</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    await userEvent.tab();

    expect((await screen.findByRole('tooltip')).textContent).toContain('Regs r.5(e), Regs r.5(f)');
    expect(screen.getByText('+2').getAttribute('aria-describedby')).toBeTruthy();
  });
});
