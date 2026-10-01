import type { ReactNode } from 'react';
import { vi } from 'vitest';

/**
 * `@tanstack/react-router` for component tests, kept free of app imports so a mock factory can
 * load it: `vi.mock('@tanstack/react-router', async () => (await import('../test/router-mock')).routerMock())`.
 * Links render as plain anchors with their params and search in the href.
 */
export const navigate = vi.fn();

export function routerMock() {
  return {
    Link: ({
      to,
      params,
      search,
      children,
      ...props
    }: {
      to: string;
      params?: Record<string, string>;
      search?: Record<string, string>;
      children: ReactNode;
    }) => {
      let href = to;
      for (const [name, value] of Object.entries(params ?? {})) {
        href = href.replace(`$${name}`, encodeURIComponent(value));
      }
      const query = new URLSearchParams(search).toString();
      return (
        <a href={query ? `${href}?${query}` : href} {...props}>
          {children}
        </a>
      );
    },
    useNavigate: () => navigate,
  };
}
