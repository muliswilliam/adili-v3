// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuthArt } from './auth-art';

describe('AuthArt', () => {
  it('names no fixed decision period for access: each Commission sets its own (decision 3)', () => {
    const { container } = render(<AuthArt variant="access" />);
    expect(screen.getByText('A decision by the Commission’s deadline')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d+ days/);
  });
});
