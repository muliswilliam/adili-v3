import { DemoBar, SiteHeaderAside, ThemePreferenceContext, ThemeSwitcher } from '@adili/ui';
import { createRootRoute, Outlet } from '@tanstack/react-router';

import { DemoContext } from '../components/demo/demo-context';
import { RootDocument } from '../components/root-document';
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
    <RootDocument theme={theme}>
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
