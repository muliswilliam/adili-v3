// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HIGHLIGHT_MS, highlightTarget } from './highlight-target';

describe('highlightTarget', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('scrolls to the target and highlights it for a moment', () => {
    vi.useFakeTimers();
    const id = 'decl-item-plot';
    document.body.innerHTML = `<div id="${id}">Plot</div>`;
    const target = document.getElementById(id);
    if (!target) throw new Error('no target');
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    expect(highlightTarget(id)).toBe(true);
    expect(scroll).toHaveBeenCalled();
    expect(target.hasAttribute('data-target-highlight')).toBe(true);
    expect(document.activeElement).toBe(target);
    vi.advanceTimersByTime(HIGHLIGHT_MS);
    expect(target.hasAttribute('data-target-highlight')).toBe(false);
  });

  it('does nothing when the page does not have the target', () => {
    expect(highlightTarget('decl-item-missing')).toBe(false);
  });
});
