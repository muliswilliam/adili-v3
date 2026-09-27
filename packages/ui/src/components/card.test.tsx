import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardIcon,
  CardTitle,
} from './card';

describe('Card', () => {
  it('renders a header with a hidden icon tile, content and footer', () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardIcon>
            <svg data-testid="icon" />
          </CardIcon>
          <CardTitle>Add new asset</CardTitle>
          <CardDescription>Land, buildings and vehicles.</CardDescription>
        </CardHeader>
        <CardContent>Fields</CardContent>
        <CardFooter>Actions</CardFooter>
      </Card>,
    );

    expect(screen.getByTestId('card').className).toContain('shadow-card');
    expect(screen.getByRole('heading', { name: 'Add new asset' })).toBeDefined();
    expect(screen.getByText('Land, buildings and vehicles.')).toBeDefined();
    expect(screen.getByText('Fields')).toBeDefined();
    expect(screen.getByText('Actions')).toBeDefined();
  });
});

describe('CardIcon', () => {
  it('is a muted tile hidden from assistive technology', () => {
    render(
      <CardIcon>
        <svg data-testid="icon" />
      </CardIcon>,
    );

    const tile = screen.getByTestId('icon').parentElement;
    expect(tile?.getAttribute('aria-hidden')).toBe('true');
    expect(tile?.className).toContain('bg-muted');
  });
});
