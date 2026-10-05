import { DemoBar, SiteHeaderAside, ThemeSwitcher } from '@adili/ui';
import { createRootRoute, Outlet } from '@tanstack/react-router';

import { RootDocument } from '../components/root-document';
import { getDemo } from '../server/demo/demo';
import { getTheme } from '../server/theme';
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
  // The demo (#616; null outside demo mode) and the theme preference. A demo switch reloads the
  // page and the theme switcher applies itself, so both are loaded once.
  loader: async () => ({ demo: await getDemo(), theme: await getTheme() }),
  staleTime: Infinity,
  component: RootComponent,
});

function RootComponent() {
  const { demo, theme } = Route.useLoaderData();
  return (
    <RootDocument theme={theme}>
      {/* In demo mode every site header carries the switcher, so it never covers a page. */}
      <SiteHeaderAside
        value={
          <>
            {demo ? (
              <DemoBar variant="inline" accounts={demo.accounts} current={demo.current} />
            ) : null}
            <ThemeSwitcher initial={theme} />
          </>
        }
      >
        <Outlet />
      </SiteHeaderAside>
      {demo ? (
        <>
          {/*
           * Pages without a site header (sign-in, onboarding) float it instead, with room below
           * the footer so it never covers the end of a page.
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
