import {
  Button,
  cn,
  focusRing,
  Icon,
  SegmentedChoice,
  SiteFooter,
  SiteHeader,
  TooltipProvider,
} from '@adili/ui';
import { ChartBarLineIcon, InformationCircleIcon, UserIcon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { type Language, pageCopy, langParam } from '../../open-data/copy';
import { SIGN_IN } from '../onboarding/links';

const navLink = cn(
  focusRing,
  'inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-secondary-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4',
  'aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-control',
);

/** Marked current by `current` alone: the router would mark /open-data current on /about too. */
const EXACT = { exact: true, includeSearch: false } as const;

/**
 * The chrome of the public open-data pages (spec 09b FE-4): no sign-in needed, so the header
 * carries Open data, About this data and Sign in; the page's language is kept in the links.
 */
export function OpenDataShell({
  current,
  language,
  children,
}: {
  current: 'open-data' | 'about';
  language: Language;
  children: ReactNode;
}) {
  const copy = pageCopy(language);
  const lang = langParam(language);
  return (
    <TooltipProvider>
      <SiteHeader
        nav={
          <nav aria-label={copy.nav} className="flex items-center gap-1">
            <Link
              to="/open-data"
              search={{ lang }}
              activeOptions={EXACT}
              aria-current={current === 'open-data' ? 'page' : undefined}
              className={navLink}
            >
              <Icon icon={ChartBarLineIcon} />
              <span className="hidden sm:inline">{copy.navOpenData}</span>
              <span className="sr-only sm:hidden">{copy.navOpenData}</span>
            </Link>
            <Link
              to="/open-data/about"
              search={{ lang }}
              activeOptions={EXACT}
              aria-current={current === 'about' ? 'page' : undefined}
              className={navLink}
            >
              <Icon icon={InformationCircleIcon} />
              <span className="hidden sm:inline">{copy.navAbout}</span>
              <span className="sr-only sm:hidden">{copy.navAbout}</span>
            </Link>
          </nav>
        }
        actions={
          <Button asChild variant="ghost" size="sm">
            <a href={SIGN_IN}>
              <Icon icon={UserIcon} />
              {copy.signIn}
            </a>
          </Button>
        }
      />
      <main lang={language} className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-14 sm:px-6">
        {children}
      </main>
      <SiteFooter />
    </TooltipProvider>
  );
}

/** The page title with the English / Kiswahili switch beside it. */
export function OpenDataHeading({
  title,
  language,
  onLanguage,
  children,
}: {
  title: string;
  language: Language;
  onLanguage: (language: Language) => void;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {children}
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
      </div>
      <SegmentedChoice
        variant="track"
        legend={pageCopy(language).language}
        value={language}
        onValueChange={(value) => {
          onLanguage(value === 'sw' ? 'sw' : 'en');
        }}
        options={[
          { value: 'en', label: <span lang="en">English</span> },
          { value: 'sw', label: <span lang="sw">Kiswahili</span> },
        ]}
      />
    </div>
  );
}
