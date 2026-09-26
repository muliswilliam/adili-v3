import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders icon, title, text and action', () => {
    render(
      <EmptyState
        icon={<svg data-testid="icon" />}
        title="No Commissions yet"
        text="Create the first Responsible Commission to start onboarding."
        action={<Button>New Commission</Button>}
      />,
    );

    expect(screen.getByRole('heading', { name: 'No Commissions yet' })).toBeTruthy();
    expect(
      screen.getByText('Create the first Responsible Commission to start onboarding.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New Commission' })).toBeTruthy();
    expect(screen.getByTestId('icon').parentElement?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders only the title when nothing else is given', () => {
    const { container } = render(<EmptyState title="No matches" />);

    expect(screen.getByRole('heading', { name: 'No matches' })).toBeTruthy();
    expect(container.querySelectorAll('p, button, [aria-hidden]')).toHaveLength(0);
  });
});
