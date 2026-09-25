import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

describe('EmptyState', () => {
  it('renders a heading, text, hidden icon and optional action', () => {
    render(
      <EmptyState
        icon={<svg data-testid="icon" />}
        title="No Commissions yet"
        text="Create the first Commission to get started."
        action={<Button>Create Commission</Button>}
      />,
    );

    expect(screen.getByRole('heading', { name: 'No Commissions yet' })).toBeDefined();
    expect(screen.getByText('Create the first Commission to get started.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Create Commission' })).toBeDefined();
    expect(screen.getByTestId('icon').parentElement?.getAttribute('aria-hidden')).toBe('true');
  });

  it('omits the action when none is given', () => {
    render(<EmptyState title="No results" />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Skeleton', () => {
  it('is hidden from assistive technology', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);

    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });
});
