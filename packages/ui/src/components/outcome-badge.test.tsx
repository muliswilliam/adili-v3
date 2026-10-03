import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OutcomeBadge } from './outcome-badge';

describe('OutcomeBadge', () => {
  it('says a compliant determination is compliant, in green', () => {
    render(<OutcomeBadge outcome="compliant" />);

    const badge = screen.getByText('Compliant');
    expect(badge.className).toContain('text-success');
    expect(badge.dataset.outcome).toBe('compliant');
  });

  it('says a bulk closure found no issues, in green', () => {
    render(<OutcomeBadge outcome="compliant-no-issues" />);

    expect(screen.getByText('Compliant: no issues identified').className).toContain('text-success');
  });

  it('says a non-compliant determination is non-compliant, in red', () => {
    render(<OutcomeBadge outcome="non-compliant" />);

    expect(screen.getByText('Non-compliant').className).toContain('text-destructive');
  });

  it('says further action is needed, in amber', () => {
    render(<OutcomeBadge outcome="further-action" />);

    expect(screen.getByText('Further action').className).toContain('text-warning');
  });

  it('carries a decorative icon beside the word, so the outcome is never colour alone', () => {
    render(<OutcomeBadge outcome="non-compliant" />);

    expect(
      screen.getByText('Non-compliant').querySelector('svg')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('takes other wording', () => {
    render(<OutcomeBadge outcome="compliant" messages={{ compliant: 'Inazingatia' }} />);

    expect(screen.getByText('Inazingatia')).toBeTruthy();
  });
});
