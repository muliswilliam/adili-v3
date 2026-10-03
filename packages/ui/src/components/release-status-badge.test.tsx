import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ReleaseStatusBadge } from './release-status-badge';

describe('ReleaseStatusBadge', () => {
  it('says a release is a preview, in blue', () => {
    render(<ReleaseStatusBadge status="preview" />);

    const badge = screen.getByText('Preview');
    expect(badge.className).toContain('text-info-subtle-foreground');
    expect(badge.dataset.status).toBe('preview');
  });

  it('says a release is published, in green', () => {
    render(<ReleaseStatusBadge status="published" />);

    expect(screen.getByText('Published').className).toContain('text-success');
  });

  it('says a release is withdrawn, in red', () => {
    render(<ReleaseStatusBadge status="withdrawn" />);

    expect(screen.getByText('Withdrawn').className).toContain('text-destructive');
  });

  it('pairs a decorative icon with the word, so the status is never colour alone', () => {
    render(<ReleaseStatusBadge status="withdrawn" />);

    expect(screen.getByText('Withdrawn').querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('takes other wording', () => {
    render(<ReleaseStatusBadge status="published" messages={{ published: 'Imechapishwa' }} />);

    expect(screen.getByText('Imechapishwa')).toBeTruthy();
  });
});
