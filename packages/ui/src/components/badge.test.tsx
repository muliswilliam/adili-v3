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
});
