import { ToastProvider, TooltipProvider } from '@adili/ui';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';

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
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
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
