import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge } from './badge';

describe('Badge', () => {
  it.each([
    ['default', 'bg-muted', 'text-secondary-foreground'],
    ['success', 'bg-success-subtle', 'text-success'],
    ['warning', 'bg-warning-subtle', 'text-warning'],
    ['destructive', 'bg-destructive-subtle', 'text-destructive'],
    ['info', 'bg-info-subtle', 'text-info-subtle-foreground'],
    ['brand', 'bg-brand-subtle', 'text-brand-subtle-foreground'],
    ['ai', 'bg-ai-subtle', 'text-ai'],
  ] as const)('renders the %s tint', (variant, fill, text) => {
    render(<Badge variant={variant}>Status</Badge>);

    const classes = screen.getByText('Status').className.split(' ');
    expect(classes).toContain(fill);
    expect(classes).toContain(text);
  });

  it('uses the default tint when no variant is given', () => {
    render(<Badge>Draft</Badge>);

    expect(screen.getByText('Draft').className.split(' ')).toContain('bg-muted');
  });

  it('is a 24px pill by default and a 22px square-cornered tag at size tag', () => {
    render(
      <>
        <Badge>Pill</Badge>
        <Badge size="tag">Act s.31(4)</Badge>
      </>,
    );

    expect(screen.getByText('Pill').className.split(' ')).toEqual(
      expect.arrayContaining(['h-6', 'rounded-full']),
    );
    const tag = screen.getByText('Act s.31(4)').className.split(' ');
    expect(tag).toEqual(expect.arrayContaining(['h-[22px]', 'rounded-md', 'font-semibold']));
    expect(tag).not.toContain('rounded-full');
  });
});
