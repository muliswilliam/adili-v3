import { Search01Icon } from '@hugeicons/core-free-icons';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Icon } from './icon';

describe('Icon', () => {
  it('renders a decorative 16px svg by default', () => {
    const { container } = render(<Icon icon={Search01Icon} />);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('class')).toContain('size-4');
    expect(svg?.getAttribute('stroke-width')).toBe('1.75');
  });

  it('lets the size and stroke be overridden', () => {
    const { container } = render(<Icon icon={Search01Icon} className="size-6" strokeWidth={2} />);

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('size-6');
    expect(svg?.getAttribute('class')).not.toContain('size-4');
    expect(svg?.getAttribute('stroke-width')).toBe('2');
  });
});
