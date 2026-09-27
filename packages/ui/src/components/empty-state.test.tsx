import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders a heading, description, hidden icon and optional action', () => {
    render(
      <EmptyState
        icon={<svg data-testid="icon" />}
        title="No Commissions yet"
        description="Create the first Commission to get started."
        action={<Button>Create Commission</Button>}
      />,
    );

    expect(screen.getByRole('heading', { name: 'No Commissions yet' })).toBeDefined();
    expect(screen.getByText('Create the first Commission to get started.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Create Commission' })).toBeDefined();
    expect(screen.getByTestId('icon').parentElement?.getAttribute('aria-hidden')).toBe('true');
  });

  it('still accepts the older text prop', () => {
    render(<EmptyState title="No results" text="Try a different search." />);

    expect(screen.getByText('Try a different search.')).toBeDefined();
  });

  it('prefers description over text when both are given', () => {
    render(<EmptyState title="No results" description="New wording" text="Old wording" />);

    expect(screen.getByText('New wording')).toBeDefined();
    expect(screen.queryByText('Old wording')).toBeNull();
  });

  it('renders only the title when nothing else is given', () => {
    const { container } = render(<EmptyState title="No results" />);

    expect(screen.getByRole('heading', { name: 'No results' })).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('p')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});
