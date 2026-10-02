// @vitest-environment jsdom
import { focusRing } from '@adili/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ItemPin } from '../../../review-case/flags';
import { DOCUMENT, PLOT } from '../../../review-case/fixtures';
import { DeclarationPane } from './declaration-pane';

function renderPane(pin: ItemPin, sectionPins = new Map<string, ItemPin>()) {
  const onPin = vi.fn();
  render(
    <DeclarationPane
      document={DOCUMENT}
      version={1}
      versions={1}
      highlight={null}
      pins={new Map([[PLOT, pin]])}
      sectionPins={sectionPins}
      onPin={onPin}
      onAttachment={vi.fn()}
      attachmentState={() => 'idle'}
      onRetry={vi.fn()}
      retrying={false}
    />,
  );
  return { onPin };
}

describe('DeclarationPane item pins', () => {
  it('M6: shows the focus ring on the pin, a button that opens its flag', () => {
    const { onPin } = renderPane({ count: 2, severity: 'high', flagId: 'flag-1' });

    const pin = screen.getByRole('button', { name: /^2 indicators/u });
    for (const part of focusRing.split(' ')) expect(pin.className).toContain(part);
    fireEvent.click(pin);
    expect(onPin).toHaveBeenCalledWith('flag-1');
  });

  it('N3: names the highest severity and shows its bars, not colour alone', () => {
    renderPane({ count: 1, severity: 'medium', flagId: 'flag-2' });

    const pin = screen.getByRole('button', {
      name: '1 indicator on this item, medium severity. Show in flags.',
    });
    // Two bars of three lit, as a medium SeverityBadge.
    const bars = [...pin.querySelectorAll('rect')].map((bar) => bar.getAttribute('opacity'));
    expect(bars).toEqual(['1', '1', '0.25']);
  });

  it("Q10: pins flags on a section as a whole to the section's heading", () => {
    const { onPin } = renderPane(
      { count: 1, severity: 'low', flagId: 'flag-1' },
      new Map([['statement:officer', { count: 2, severity: 'high', flagId: 'flag-3' }]]),
    );

    const pin = screen.getByRole('button', {
      name: '2 indicators on this section, highest severity: high. Show in flags.',
    });
    expect(pin.closest('#case-declaration-section-statement-officer')).toBeTruthy();
    fireEvent.click(pin);
    expect(onPin).toHaveBeenCalledWith('flag-3');
  });
});
