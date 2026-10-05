import {
  DemoBar,
  SiteHeaderAside,
  THEME_SCRIPT,
  ThemePreferenceContext,
  ThemeSwitcher,
  ToastProvider,
  TooltipProvider,
} from '@adili/ui';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { DemoContext } from '../components/demo/demo-context';
import { getDemo } from '../server/demo/demo';
import { getTheme } from '../server/theme';
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
  // The demo (#616; null outside demo mode) and the theme preference. A demo switch reloads the
  // page and the theme switcher applies itself, so both are loaded once.
  loader: async () => ({ demo: await getDemo(), theme: await getTheme() }),
  staleTime: Infinity,
  component: RootComponent,
});

function RootComponent() {
  const { demo, theme } = Route.useLoaderData();
  return (
    <RootDocument>
      <ThemePreferenceContext value={theme}>
        <DemoContext value={demo}>
          {/* The signed-out pages' site header carries the switcher too, so it never covers a page. */}
          <SiteHeaderAside
            value={
              <>
                {demo ? (
                  <DemoBar variant="inline" accounts={demo.accounts} current={demo.current} />
                ) : null}
                <ThemeSwitcher />
              </>
            }
          >
            <Outlet />
          </SiteHeaderAside>
        </DemoContext>
      </ThemePreferenceContext>
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
    // The head script sets data-theme before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Sets the theme before the first paint: the shared cookie's choice, or the device's. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
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
