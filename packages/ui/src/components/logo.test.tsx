import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Logo, LogoMark, LogoWordmark } from './logo';

describe('LogoWordmark', () => {
  it('is an image named after the visible wordmark', () => {
    render(<LogoWordmark />);

    expect(screen.getByRole('img', { name: 'Dials' })).toBeDefined();
  });

  it('gives each instance its own mask and clip path, and references them', () => {
    const { container } = render(
      <>
        <LogoWordmark />
        <LogoWordmark />
      </>,
    );

    const masks = [...container.querySelectorAll('mask')];
    const clips = [...container.querySelectorAll('clipPath')];
    expect(masks).toHaveLength(2);
    expect(new Set(masks.map((mask) => mask.id)).size).toBe(2);
    expect(new Set(clips.map((clip) => clip.id)).size).toBe(2);

    for (const svg of container.querySelectorAll('svg')) {
      const mask = svg.querySelector('mask');
      const clip = svg.querySelector('clipPath');
      expect(svg.querySelector('g[mask]')?.getAttribute('mask')).toBe(`url(#${mask?.id})`);
      expect(mask?.querySelector('g')?.getAttribute('clip-path')).toBe(`url(#${clip?.id})`);
    }
  });
});

describe('Logo', () => {
  it('shows the product name after the wordmark', () => {
    render(<Logo product="Console" />);

    expect(screen.getByRole('img', { name: 'Dials' })).toBeDefined();
    expect(screen.getByText('Console')).toBeDefined();
  });

  it('omits the product name when none is given', () => {
    const { container } = render(<Logo />);

    expect(container.querySelectorAll('span')).toHaveLength(1);
  });
});

describe('LogoMark', () => {
  it('is decorative', () => {
    const { container } = render(<LogoMark />);

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
