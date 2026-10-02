import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PRIORITY_BANDS, PriorityBadge } from './priority-badge';

describe('PriorityBadge', () => {
  it.each([
    ['high', 'High'],
    ['medium', 'Medium'],
    ['low', 'Low'],
  ] as const)('shows %s in text, with the note in its accessible name', (band, text) => {
    render(<PriorityBadge band={band} />);

    const badge = screen.getByRole('img', {
      name: `${text} priority. Indicator for ordering only. Not a finding.`,
    });
    expect(badge.textContent).toBe(text);
    expect(badge.getAttribute('data-band')).toBe(band);
    expect(badge.tabIndex).toBe(0);
  });

  it('lights one bar more per band', () => {
    const lit = PRIORITY_BANDS.map((band) => {
      const { container, unmount } = render(<PriorityBadge band={band} />);
      const bars = [...container.querySelectorAll('rect')];
      unmount();
      return bars.filter((bar) => bar.getAttribute('opacity') !== '0.25').length;
    });
    expect(lit).toEqual([1, 2, 3]);
  });

  it('shows the note in a tooltip on focus', () => {
    render(<PriorityBadge band="high" />);

    fireEvent.focus(screen.getByRole('img'));

    expect(screen.getByRole('tooltip').textContent).toBe(
      'Indicator for ordering only. Not a finding.',
    );
  });

  it('can leave out the tooltip and the tab stop, keeping the note for screen readers', () => {
    render(<PriorityBadge band="medium" tooltip={false} />);

    const badge = screen.getByRole('img', {
      name: 'Medium priority. Indicator for ordering only. Not a finding.',
    });
    expect(badge.hasAttribute('tabindex')).toBe(false);
    fireEvent.focus(badge);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('takes other copy', () => {
    render(
      <PriorityBadge
        band="low"
        messages={{
          bands: { low: 'Chini', medium: 'Wastani', high: 'Juu' },
          note: 'Kwa mpangilio tu.',
        }}
      />,
    );

    expect(screen.getByRole('img', { name: 'Chini priority. Kwa mpangilio tu.' }).textContent).toBe(
      'Chini',
    );
  });
});
