import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VersionBadge } from './version-badge';

describe('VersionBadge', () => {
  it('names the version, in blue', () => {
    render(<VersionBadge version={3} />);

    const badge = screen.getByText('Version 3');
    expect(badge.className).toContain('bg-info-subtle');
  });

  it('says the current version is current, in green', () => {
    render(<VersionBadge version={2} state="current" />);

    const badge = screen.getByText('Version 2 · current');
    expect(badge.className).toContain('text-success');
    expect(badge.dataset.state).toBe('current');
  });

  it('says an older version is superseded, in amber', () => {
    render(<VersionBadge version={1} state="superseded" />);

    expect(screen.getByText('Version 1 · superseded').className).toContain('text-warning');
  });

  it('takes other wording', () => {
    render(
      <VersionBadge
        version={2}
        state="superseded"
        messages={{ version: (n) => `Toleo ${String(n)}`, superseded: 'limepitwa' }}
      />,
    );

    expect(screen.getByText('Toleo 2 · limepitwa')).toBeTruthy();
  });
});
