import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { cn } from '../lib/cn';
import { Button } from './button';

describe('Button', () => {
  it('renders a native button by default', () => {
    render(<Button>Sign in</Button>);

    expect(screen.getByRole('button', { name: 'Sign in' }).tagName).toBe('BUTTON');
  });

  it('renders its child with button styles when asChild is set', () => {
    render(
      <Button asChild variant="outline">
        <a href="/auth/login">Sign in</a>
      </Button>,
    );

    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link.getAttribute('href')).toBe('/auth/login');
    expect(link.className).toContain('shadow-control');
  });
});

describe('cn', () => {
  it('lets later utilities override conflicting earlier ones', () => {
    expect(cn('px-4 text-sm', false, 'px-6')).toBe('text-sm px-6');
  });
});
