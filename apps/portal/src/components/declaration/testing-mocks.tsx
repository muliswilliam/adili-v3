import type { ReactNode } from 'react';
import { vi } from 'vitest';

/**
 * Module mocks for workspace tests. Kept free of app imports so a mocked module's factory can
 * load it without a cycle:
 *
 *   vi.mock('@tanstack/react-router', async () => (await import('./testing-mocks')).routerMock());
 *   vi.mock('../../server/declarations', async () =>
 *     (await import('./testing-mocks')).serverMock(),
 *   );
 */

export const navigate = vi.fn();
export const invalidate = vi.fn(() => Promise.resolve());

export function routerMock() {
  return {
    Link: ({
      to,
      params,
      children,
      ...props
    }: {
      to: string;
      params?: Record<string, string>;
      children: ReactNode;
    }) => {
      let href = to;
      for (const [name, value] of Object.entries(params ?? {})) {
        href = href.replace(`$${name}`, encodeURIComponent(value));
      }
      return (
        <a href={href} {...props}>
          {children}
        </a>
      );
    },
    useNavigate: () => navigate,
    useRouter: () => ({ invalidate }),
  };
}

export function serverMock() {
  return {
    getDeclaration: vi.fn(),
    getDeclarationSection: vi.fn(),
    saveDeclarationSection: vi.fn(),
    startMyDeclaration: vi.fn(),
    getMyObligations: vi.fn(),
    getMyDeclarations: vi.fn(),
    discardMyDeclaration: vi.fn(),
    linkDeclarationAttachment: vi.fn(),
    unlinkDeclarationAttachment: vi.fn(),
    getDeclarationSummary: vi.fn(),
  };
}
