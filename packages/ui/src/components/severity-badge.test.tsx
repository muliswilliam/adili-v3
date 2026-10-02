import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SEVERITIES, SeverityBadge } from './severity-badge';

describe('SeverityBadge', () => {
  it('says each severity in words, tinted from red to grey', () => {
    render(
      <>
        {SEVERITIES.map((severity) => (
          <SeverityBadge key={severity} severity={severity} />
        ))}
      </>,
    );

    expect(screen.getByText('High').className).toContain('text-destructive');
    expect(screen.getByText('Medium').className).toContain('text-warning');
    expect(screen.getByText('Low').className).toContain('text-info-subtle-foreground');
    expect(screen.getByText('Info').className).toContain('text-secondary-foreground');
  });

  it('lights one bar per step and marks info without bars', () => {
    const { container } = render(
      <>
        <SeverityBadge severity="medium" />
        <SeverityBadge severity="info" />
      </>,
    );

    const [medium, info] = Array.from(container.querySelectorAll('[data-severity]'));
    const lit = Array.from(medium?.querySelectorAll('rect') ?? []).filter(
      (bar) => bar.getAttribute('opacity') === '1',
    );
    expect(lit).toHaveLength(2);
    expect(info?.querySelectorAll('rect')).toHaveLength(0);
  });

  it('takes another word', () => {
    render(<SeverityBadge severity="high" label="Juu" />);

    expect(screen.getByText('Juu').dataset.severity).toBe('high');
  });
});
