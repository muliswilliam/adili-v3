import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Alert, AlertDescription, AlertTitle } from './alert';

describe('Alert', () => {
  it('announces its title and description on the neutral fill by default', () => {
    render(
      <Alert>
        <AlertTitle>Draft saved</AlertTitle>
        <AlertDescription>You can finish it later.</AlertDescription>
      </Alert>,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Draft savedYou can finish it later.');
    expect(alert.className.split(' ')).toContain('bg-muted');
  });

  it.each([
    ['neutral', 'bg-muted', 'text-secondary-foreground'],
    ['info', 'bg-info-subtle', 'text-info-subtle-foreground'],
    ['success', 'bg-success-subtle', 'text-success-subtle-foreground'],
    ['warning', 'bg-warning-subtle', 'text-warning-subtle-foreground'],
    ['destructive', 'bg-destructive-subtle', 'text-destructive-subtle-foreground'],
    ['ai', 'bg-ai-subtle', 'text-ai-subtle-foreground'],
    ['brand', 'bg-brand-subtle', 'text-brand-subtle-foreground'],
  ] as const)('renders the %s callout', (variant, fill, text) => {
    render(<Alert variant={variant}>Message</Alert>);

    const classes = screen.getByRole('alert').className.split(' ');
    expect(classes).toContain(fill);
    expect(classes).toContain(text);
  });
});
