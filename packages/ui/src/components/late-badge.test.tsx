import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LateBadge } from './late-badge';

describe('LateBadge', () => {
  it('says it was filed late, in amber with a clock', () => {
    const { container } = render(<LateBadge />);

    const badge = screen.getByText('Filed late');
    expect(badge.className).toContain('text-warning');
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('takes other wording', () => {
    render(<LateBadge label="Imewasilishwa kwa kuchelewa" />);

    expect(screen.getByText('Imewasilishwa kwa kuchelewa')).toBeTruthy();
  });
});
