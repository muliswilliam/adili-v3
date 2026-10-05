import { SiteHeader, ThemeToggle } from '@adili/ui';
import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { RootDocument } from '../components/root-document';
import { verifyMessages as copy } from '../copy';
import { getTheme } from '../server/theme';
import appCss from '../styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: copy.title },
      { name: 'description', content: copy.description },
      // A verification page is only for whoever holds the document (ADR-010).
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'referrer', content: 'no-referrer' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  loader: () => getTheme(),
  staleTime: Infinity,
  shellComponent: RootShell,
  component: RootComponent,
});

function RootComponent() {
  const theme = Route.useLoaderData();
  return (
    <>
      {/* A toggle, not the menu: the verify page keeps to its script budget. */}
      <SiteHeader product="Verify" actions={<ThemeToggle initial={theme} />} />
      <main className="mx-auto w-full max-w-[620px] flex-1 px-4 pt-7 pb-12 sm:px-6 sm:pt-14 sm:pb-[72px]">
        <Outlet />
      </main>
      <footer className="border-t px-4 pt-5 pb-7 text-center text-[13px] text-muted-foreground">
        <p>{copy.footerRecorded}</p>
        <p className="mt-1.5">
          Adili Online ·{' '}
          <Link
            to="/about"
            className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            {copy.footerAbout}
          </Link>
        </p>
      </footer>
    </>
  );
}

function RootShell({ children }: Readonly<{ children: ReactNode }>) {
  return <RootDocument theme={Route.useLoaderData()}>{children}</RootDocument>;
}
