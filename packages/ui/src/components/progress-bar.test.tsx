import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  it('exposes its value to assistive technology', () => {
    render(<ProgressBar label="Uploading roster.csv" value={30} valueText="30 of 100 rows" />);

    const bar = screen.getByRole('progressbar', { name: 'Uploading roster.csv' });
    expect(bar.getAttribute('aria-valuenow')).toBe('30');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuetext')).toBe('30 of 100 rows');
  });

  it('announces only when progress crosses a coarse step', () => {
    const { rerender } = render(<ProgressBar label="Importing" value={10} max={200} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');

    rerender(<ProgressBar label="Importing" value={60} max={200} />);
    expect(status.textContent).toBe('25%');

    rerender(<ProgressBar label="Importing" value={90} max={200} />);
    expect(status.textContent).toBe('25%');

    rerender(<ProgressBar label="Importing" value={100} max={200} />);
    expect(status.textContent).toBe('50%');
  });

  it('clamps values outside the range', () => {
    render(<ProgressBar label="Uploading" value={150} />);

    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('100%');
  });

  it('shows the status and percentage under the bar', () => {
    render(<ProgressBar label="Import progress" value={25} status="12,108 of 48,431 rows" />);

    const status = screen.getByText('12,108 of 48,431 rows');
    expect(status.nextElementSibling?.textContent).toBe('25%');
  });

  it('has no value while indeterminate', () => {
    render(
      <ProgressBar label="Import progress" value={60} indeterminate status="Reading the file…" />,
    );

    const bar = screen.getByRole('progressbar', { name: 'Import progress' });
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.hasAttribute('aria-valuetext')).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByText('60%')).toBeNull();
  });
});
