// @vitest-environment jsdom
import { ACCESS_OFFICER, LAW_ENFORCEMENT } from '@adili/roles';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Viewer } from '../server/viewer';
import { WorkspaceLayout } from './workspace-layout';
import { workspaceFor } from './workspaces';

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock('./shell/console-shell', () => ({
  ConsoleShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const viewer = (ok: boolean): Viewer =>
  ({
    user: { name: 'Jane Wanjiru' },
    directory: ok ? { ok: true, principal: {} } : { ok: false, error: { kind: 'unavailable' } },
  }) as unknown as Viewer;

function renderLayout(ok: boolean, roles: string[]) {
  render(
    <WorkspaceLayout
      viewer={viewer(ok)}
      roles={roles}
      workspace={workspaceFor(roles, 'access') ?? null}
      title="Access requests"
      forbidden="You do not have access to access requests."
    >
      <p>The queue</p>
    </WorkspaceLayout>,
  );
}

describe('WorkspaceLayout', () => {
  it('shows the workspace to whoever has it', () => {
    renderLayout(true, [ACCESS_OFFICER]);
    expect(screen.getByText('The queue')).toBeTruthy();
  });

  it('says the workspace is not theirs, with the way back', () => {
    renderLayout(true, [LAW_ENFORCEMENT]);
    expect(screen.queryByText('The queue')).toBeNull();
    expect(screen.getByText('You do not have access to access requests.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to overview' }).getAttribute('href')).toBe('/');
  });

  it('offers a retry when the access could not load', () => {
    renderLayout(false, []);
    expect(screen.getByText('We could not load your access')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('says an account has no staff roles', () => {
    renderLayout(true, []);
    expect(screen.getByText('No staff roles')).toBeTruthy();
  });
});
