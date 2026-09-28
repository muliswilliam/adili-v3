import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ObligationStatusBadge } from './obligation-status-badge';

describe('ObligationStatusBadge', () => {
  it.each([
    ['upcoming', 'Upcoming', 'neutral'],
    ['due', 'Due', 'info'],
    ['overdue', 'Overdue', 'warning'],
    ['filed', 'Filed', 'success'],
    ['cancelled', 'Cancelled', 'neutral'],
  ] as const)('words %s with the shared variant', (status, word, variant) => {
    render(<ObligationStatusBadge status={status} />);

    const badge = screen.getByText(word);
    expect(badge.getAttribute('data-variant')).toBe(variant);
    expect(badge.querySelector('svg')).not.toBeNull();
  });

  it('draws cancelled with a different icon from upcoming', () => {
    const { container } = render(
      <>
        <ObligationStatusBadge status="upcoming" />
        <ObligationStatusBadge status="cancelled" />
      </>,
    );
    const [upcoming, cancelled] = container.querySelectorAll('svg');
    expect(upcoming?.innerHTML).not.toBe(cancelled?.innerHTML);
  });
});
