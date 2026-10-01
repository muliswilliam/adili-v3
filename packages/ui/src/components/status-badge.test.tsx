import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it.each([
    ['neutral', 'Upcoming', 'bg-muted'],
    ['info', 'Due', 'bg-info-subtle'],
    ['warning', 'Overdue', 'bg-warning-subtle'],
    ['success', 'Filed', 'bg-success-subtle'],
  ] as const)('%s carries its text and a decorative icon', (variant, text, fill) => {
    render(<StatusBadge variant={variant}>{text}</StatusBadge>);

    const badge = screen.getByText(text);
    expect(badge.className).toContain(fill);
    expect(badge.getAttribute('data-variant')).toBe(variant);
    const icon = badge.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is neutral by default', () => {
    render(<StatusBadge>Upcoming</StatusBadge>);

    expect(screen.getByText('Upcoming').getAttribute('data-variant')).toBe('neutral');
  });

  it('can drop the icon', () => {
    render(
      <StatusBadge variant="info" icon={null}>
        Due
      </StatusBadge>,
    );

    expect(screen.getByText('Due').querySelector('svg')).toBeNull();
  });
});
