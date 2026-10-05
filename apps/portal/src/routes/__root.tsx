import { DemoBar } from '@adili/ui';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { getDemo } from '../server/demo/demo';
import appCss from '../styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Adili Online: declare income, assets and liabilities' },
      {
        name: 'description',
        content:
          'File your declaration of income, assets and liabilities under the Conflict of Interest Act, 2025.',
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  // Demo mode only (#616); null otherwise. A switch reloads the page, so it is loaded once.
  loader: () => getDemo(),
  staleTime: Infinity,
  component: RootComponent,
});

function RootComponent() {
  const demo = Route.useLoaderData();
  return (
    <RootDocument>
      <Outlet />
      {demo ? (
        <>
          {/* Room below the footer, so the fixed demo bar never covers the end of a page. */}
          <div aria-hidden="true" className="h-16 shrink-0" />
          <DemoBar accounts={demo.accounts} current={demo.current} />
        </>
      ) : null}
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="flex min-h-dvh flex-col">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}
