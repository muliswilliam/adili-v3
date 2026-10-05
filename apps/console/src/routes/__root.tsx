import { DemoBar, SiteHeaderAside, ToastProvider, TooltipProvider } from '@adili/ui';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { DemoContext } from '../components/demo/demo-context';
import { getDemo } from '../server/demo/demo';
import appCss from '../styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Adili Online Console' },
      {
        name: 'description',
        content:
          'Review declarations, manage compliance and report to EACC under the Conflict of Interest Act, 2025.',
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
      <DemoContext value={demo}>
        {/* The signed-out pages' site header carries the switcher too, so it never covers a page. */}
        <SiteHeaderAside
          value={
            demo ? (
              <DemoBar variant="inline" accounts={demo.accounts} current={demo.current} />
            ) : null
          }
        >
          <Outlet />
        </SiteHeaderAside>
      </DemoContext>
      {demo ? (
        <>
          {/*
           * A page without a header for it floats the switcher instead, with room below the
           * footer so it never covers the end of a page.
           */}
          <div
            aria-hidden="true"
            className="h-16 shrink-0 [body:has([data-demo-bar=inline])_&]:hidden"
          />
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
        <TooltipProvider>
          <ToastProvider>
            {/* Pages place the site footer: below the content, never under the sidebar. */}
            <div className="flex min-h-dvh flex-col">{children}</div>
          </ToastProvider>
        </TooltipProvider>
        <Scripts />
      </body>
    </html>
  );
}
