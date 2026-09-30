import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IconTile } from './icon-tile';

describe('IconTile', () => {
  it('is a muted 34px tile hidden from assistive technology by default', () => {
    render(
      <IconTile data-testid="tile">
        <svg />
      </IconTile>,
    );

    const tile = screen.getByTestId('tile');
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.className).toContain('size-[34px]');
    expect(tile.className).toContain('rounded-lg');
    expect(tile.className).toContain('bg-muted');
  });

  it('takes a status tone', () => {
    render(<IconTile data-testid="tile" tone="brand" />);

    expect(screen.getByTestId('tile').className).toContain('bg-brand-subtle');
  });

  it('lets the caller merge layout classes', () => {
    render(<IconTile data-testid="tile" className="mb-2" />);

    expect(screen.getByTestId('tile').className).toContain('mb-2');
  });
});
