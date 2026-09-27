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

  it('treats a value that is not a number as zero', () => {
    render(<ProgressBar label="Uploading" value={Number.NaN} />);

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(bar.getAttribute('aria-valuetext')).toBe('0%');
    expect(screen.getByText('0%')).toBeDefined();
  });

  it('falls back to 100 when max is not a positive number', () => {
    render(<ProgressBar label="Uploading" value={50} max={Number.NaN} />);

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuetext')).toBe('50%');
  });

  it('falls back to the default step when announceEvery is not a positive number', () => {
    const { rerender } = render(<ProgressBar label="Importing" value={30} announceEvery={0} />);
    expect(screen.getByRole('status').textContent).toBe('25%');

    rerender(<ProgressBar label="Importing" value={60} announceEvery={Number.NaN} />);
    expect(screen.getByRole('status').textContent).toBe('50%');
  });

  it('announces the value text instead of a percentage when given', () => {
    const { rerender } = render(
      <ProgressBar label="Importing" value={10} valueText="10 of 100 rows" />,
    );
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');

    rerender(<ProgressBar label="Importing" value={30} valueText="30 of 100 rows" />);
    expect(status.textContent).toBe('30 of 100 rows');

    // Still only at step crossings, not on every update.
    rerender(<ProgressBar label="Importing" value={40} valueText="40 of 100 rows" />);
    expect(status.textContent).toBe('30 of 100 rows');
  });

  it('colours the bar by tone and sizes it', () => {
    const { rerender } = render(
      <ProgressBar label="Import" value={100} tone="success" size="sm" />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar.className).toContain('h-1.5');
    expect(bar.firstElementChild?.className).toContain('bg-success');

    rerender(<ProgressBar label="Import" value={40} tone="destructive" />);
    expect(bar.className).toContain('h-2.5');
    expect(bar.firstElementChild?.className).toContain('bg-destructive');

    rerender(<ProgressBar label="Import" value={40} />);
    expect(bar.firstElementChild?.className).toContain('bg-primary');
  });
});
