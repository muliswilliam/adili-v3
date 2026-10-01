import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BreakerBadge } from './breaker-badge';

describe('BreakerBadge', () => {
  it('says a closed breaker is closed, in green', () => {
    render(<BreakerBadge state="closed" />);

    const badge = screen.getByText('Closed');
    expect(badge.className).toContain('text-success');
    expect(badge.dataset.state).toBe('closed');
  });

  it('says a half-open breaker is half-open, in amber', () => {
    render(<BreakerBadge state="half-open" />);

    expect(screen.getByText('Half-open').className).toContain('text-warning');
  });

  it('says an open breaker is open, in red', () => {
    render(<BreakerBadge state="open" />);

    expect(screen.getByText('Open').className).toContain('text-destructive');
  });

  it('carries a decorative icon beside the word', () => {
    render(<BreakerBadge state="open" />);

    expect(screen.getByText('Open').querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('takes other wording', () => {
    render(<BreakerBadge state="open" messages={{ open: 'Imefungwa' }} />);

    expect(screen.getByText('Imefungwa')).toBeTruthy();
  });
});
