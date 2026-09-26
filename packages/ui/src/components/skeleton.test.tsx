import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from './skeleton';

describe('Skeleton', () => {
  it('is hidden from assistive technology', () => {
    const { container } = render(<Skeleton />);

    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('takes its size from the caller', () => {
    const { container } = render(<Skeleton className="h-3 w-24" />);

    const className = container.firstElementChild?.className ?? '';
    expect(className).toContain('w-24');
    expect(className).toContain('h-3');
    expect(className).not.toContain('h-4');
  });
});
