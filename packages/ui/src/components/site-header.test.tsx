// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SiteHeader, SiteHeaderAside } from './site-header';

describe('SiteHeader', () => {
  it("shows what the app sets aside for every header ahead of the page's own actions", () => {
    render(
      <SiteHeaderAside value={<span>Demo switcher</span>}>
        <SiteHeader actions={<button type="button">Sign out</button>} />
      </SiteHeaderAside>,
    );
    const aside = screen.getByText('Demo switcher');
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    expect(aside.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows only the actions without one', () => {
    render(<SiteHeader actions={<button type="button">Sign out</button>} />);
    expect(screen.getByRole('banner').textContent).not.toContain('Demo switcher');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});
