import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Meter } from './meter';

describe('Meter', () => {
  it('is hidden from screen readers without a label', () => {
    const { container } = render(<Meter value={0.42} />);

    const meter = container.firstElementChild as HTMLElement;
    expect(meter.getAttribute('aria-hidden')).toBe('true');
    expect(meter.hasAttribute('role')).toBe(false);
    expect((meter.firstElementChild as HTMLElement).style.width).toBe('42%');
  });

  it('exposes its value when labelled', () => {
    render(<Meter label="Cache hit rate" value={30} max={120} valueText="25%" />);

    const meter = screen.getByRole('meter', { name: 'Cache hit rate' });
    expect(meter.getAttribute('aria-valuenow')).toBe('30');
    expect(meter.getAttribute('aria-valuemax')).toBe('120');
    expect(meter.getAttribute('aria-valuetext')).toBe('25%');
    expect((meter.firstElementChild as HTMLElement).style.width).toBe('25%');
  });

  it('clamps the fill and treats a value that is not a number as zero', () => {
    const { container, rerender } = render(<Meter value={1.7} />);
    const fill = () => (container.firstElementChild?.firstElementChild as HTMLElement).style.width;
    expect(fill()).toBe('100%');

    rerender(<Meter value={Number.NaN} />);
    expect(fill()).toBe('0%');

    rerender(<Meter value={0.5} max={0} />);
    expect(fill()).toBe('50%');
  });
});
