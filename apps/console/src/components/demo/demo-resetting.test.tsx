// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RestartDeps } from './demo-restart';
import { DemoResetting } from './demo-resetting';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DemoResetting (#622)', () => {
  it('counts down, says who is signed out, then opens the start page once the console is back', async () => {
    let back: () => void = () => undefined;
    let onPhase: RestartDeps['onPhase'];
    const restart = vi.fn((deps: Partial<RestartDeps> = {}) => {
      onPhase = deps.onPhase;
      return new Promise<void>((resolve) => {
        back = resolve;
      });
    });
    const navigate = vi.fn();
    render(<DemoResetting checkpoint="0-start" restart={restart} navigate={navigate} />);

    const status = screen.getByRole('status', { name: /Resetting the demo to 0-start/ });
    expect(status.textContent).toContain('everyone is signed out of the portal and the console');
    expect(status.textContent).toContain('Stopping the apps');
    expect(status.textContent).toContain('About 4 minutes left');

    act(() => {
      onPhase?.('restoring');
      vi.advanceTimersByTime(3 * 60_000 + 30_000);
    });
    expect(status.textContent).toContain('Restoring the checkpoint');
    expect(status.textContent).toContain('About 30 seconds left');
    expect(navigate).not.toHaveBeenCalled();

    await act(async () => {
      onPhase?.('back');
      back();
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('keeps waiting, and says so, past the usual time', () => {
    render(
      <DemoResetting
        checkpoint="2-after-review"
        restart={() => new Promise(() => undefined)}
        navigate={vi.fn()}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(6 * 60_000);
    });
    expect(screen.getByRole('status').textContent).toContain('Taking a little longer than usual');
  });
});
