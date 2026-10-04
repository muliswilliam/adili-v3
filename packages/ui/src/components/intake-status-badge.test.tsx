import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IntakeStatusBadge } from './intake-status-badge';

describe('IntakeStatusBadge', () => {
  it('says a Commission reported on time, in green', () => {
    render(<IntakeStatusBadge status="submitted-on-time" />);

    const badge = screen.getByText('Reported on time');
    expect(badge.className).toContain('text-success');
    expect(badge.dataset.status).toBe('submitted-on-time');
  });

  it('says a Commission reported late, in amber', () => {
    render(<IntakeStatusBadge status="submitted-late" />);

    expect(screen.getByText('Reported late').className).toContain('text-warning');
  });

  it('says a Commission has not reported, in red', () => {
    render(<IntakeStatusBadge status="not-reported" />);

    expect(screen.getByText('Not reported').className).toContain('text-destructive');
  });

  it('pairs a decorative icon with the word, so the status is never colour alone', () => {
    render(<IntakeStatusBadge status="submitted-late" />);

    expect(
      screen.getByText('Reported late').querySelector('svg')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('takes other wording', () => {
    render(
      <IntakeStatusBadge status="not-reported" messages={{ 'not-reported': 'Haijaripotiwa' }} />,
    );

    expect(screen.getByText('Haijaripotiwa')).toBeTruthy();
  });
});
