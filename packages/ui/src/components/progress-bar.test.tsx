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
});
