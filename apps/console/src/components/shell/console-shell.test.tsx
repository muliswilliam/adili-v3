// @vitest-environment jsdom
import { REPORTING_OFFICER } from '@adili/roles';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConsoleShell } from './console-shell';

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => '/roster/coverage',
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock('../demo/demo-context', () => ({ ShellDemoBar: () => null }));
vi.mock('../demo/demo-panel', () => ({ DemoPanel: () => null }));
vi.mock('./breadcrumbs', () => ({ Breadcrumbs: () => null }));
// The theme switcher reads the device's colour scheme, which jsdom does not have.
vi.mock('@adili/ui', async (original) => ({
  ...(await original<object>()),
  ThemeSwitcher: () => null,
}));
// jsdom has <dialog> without its methods; the drawer closes itself on every navigation.
HTMLDialogElement.prototype.close = vi.fn();

describe('ConsoleShell', () => {
  it("runs the sidebar's background the page's full height, its contents kept to the window (#622)", () => {
    const { container } = render(
      <ConsoleShell userName="Grace Mutiso" roles={[REPORTING_OFFICER]}>
        <p>A page longer than the window</p>
      </ConsoleShell>,
    );

    // The grid cell stretches to the page's height and carries the background and border, so a
    // full-page screenshot shows no blank column below the sidebar.
    const column = container.querySelector('[data-sidebar-column]');
    if (!column) throw new Error('no sidebar column');
    expect(column.classList).toContain('bg-muted/60');
    expect(column.classList).toContain('border-r');
    expect(column.classList).not.toContain('h-dvh');
    // The sidebar itself stays in view as the page scrolls.
    const aside = column.querySelector('aside');
    expect(aside?.classList).toContain('sticky');
    expect(aside?.classList).toContain('top-0');
    expect(aside?.classList).toContain('h-dvh');
  });
});
