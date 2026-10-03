import type { ComponentProps, ReactNode } from 'react';

/**
 * The router's `Link` as a plain anchor (path params and search filled in), for the help
 * components' tests to put in their `vi.mock('@tanstack/react-router', ...)`.
 */
export function TestLink({
  to,
  params,
  search,
  children,
  ...props
}: Omit<ComponentProps<'a'>, 'href'> & {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  children?: ReactNode;
}) {
  let href = to;
  for (const [key, value] of Object.entries(params ?? {})) href = href.replace(`$${key}`, value);
  const query = new URLSearchParams(search).toString();
  return (
    <a href={query ? `${href}?${query}` : href} {...props}>
      {children}
    </a>
  );
}

/** The `index`th item of a list a test expects to be there. */
export function nth<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`no item ${String(index)}`);
  return item;
}
