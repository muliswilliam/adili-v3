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
      <Button asChild variant="secondary">
        <a href="/auth/login">Sign in</a>
      </Button>,
    );

    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link.getAttribute('href')).toBe('/auth/login');
    expect(link.className).toContain('shadow-control');
  });

  it.each([
    ['default', 'bg-primary'],
    ['secondary', 'shadow-control'],
    ['ghost', 'text-secondary-foreground'],
    ['destructive', 'bg-destructive'],
    ['destructive-ghost', 'hover:bg-destructive-subtle'],
    ['link', 'underline'],
  ] as const)('renders the %s variant', (variant, expected) => {
    render(<Button variant={variant}>Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' }).className.split(' ')).toContain(expected);
  });

  it.each([
    ['xs', 'h-7'],
    ['sm', 'h-[34px]'],
    ['default', 'h-11'],
    ['icon', 'size-9'],
  ] as const)('renders the %s size', (size, expected) => {
    render(<Button size={size}>Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' }).className.split(' ')).toContain(expected);
  });

  it('keeps links inline with text and rounds them once', () => {
    render(<Button variant="link">Read more</Button>);

    const classes = screen.getByRole('button', { name: 'Read more' }).className.split(' ');
    expect(classes).toContain('h-auto');
    expect(classes).toContain('px-0');
    expect(classes.filter((name) => name.startsWith('rounded'))).toEqual(['rounded-sm']);
  });

  it('turns the primary button grey when disabled', () => {
    render(<Button disabled>Save</Button>);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.className.split(' ')).toContain('disabled:bg-primary-disabled');
  });
});

describe('cn', () => {
  it('lets later utilities override conflicting earlier ones', () => {
    expect(cn('px-4 text-sm', false, 'px-6')).toBe('text-sm px-6');
  });
});
