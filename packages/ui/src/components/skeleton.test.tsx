import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from './skeleton';

describe('Skeleton', () => {
  it('is hidden from assistive technology', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);

    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('pulses and takes the caller size over its default', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);

    const skeleton = container.firstElementChild;
    expect(skeleton?.className).toContain('animate-pulse');
    expect(skeleton?.className).toContain('h-4');
    expect(skeleton?.className).not.toContain('h-3');
  });

  it('sits inside a region marked busy while loading', () => {
    const { container } = render(
      <div aria-busy="true" aria-label="Commissions">
        <Skeleton />
        <Skeleton />
      </div>,
    );

    expect(container.querySelectorAll('[aria-busy="true"] > [aria-hidden="true"]')).toHaveLength(2);
  });
});
