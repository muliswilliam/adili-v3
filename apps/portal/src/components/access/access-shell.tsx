import {
  cn,
  focusRing,
  Icon,
  SiteFooter,
  SiteHeader,
  ToastProvider,
  TooltipProvider,
} from '@adili/ui';
import { Add01Icon, LeftToRightListBulletIcon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { ACCESS_SHELL_COPY as COPY } from '../../access/copy';
import { SignOutButton } from '../sign-out-button';

const navLink = cn(
  focusRing,
  'inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-secondary-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4',
  'aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-control',
);

/**
 * The chrome around the applicant's access request pages: the header with My requests and New
 * request, and the footer. `current` marks the page the applicant is on in the navigation.
 */
export function AccessShell({
  current,
  children,
}: {
  current?: 'requests' | 'new';
  children: ReactNode;
}) {
  return (
    <ToastProvider>
      <TooltipProvider>
        <SiteHeader
          nav={
            <nav aria-label={COPY.nav} className="flex items-center gap-1">
              <Link
                to="/access/requests"
                search={{}}
                aria-current={current === 'requests' ? 'page' : undefined}
                className={navLink}
              >
                <Icon icon={LeftToRightListBulletIcon} />
                <span className="hidden sm:inline">{COPY.myRequests}</span>
                <span className="sr-only sm:hidden">{COPY.myRequests}</span>
              </Link>
              <Link
                to="/access/requests/new"
                aria-current={current === 'new' ? 'page' : undefined}
                className={navLink}
              >
                <Icon icon={Add01Icon} />
                <span className="hidden sm:inline">{COPY.newRequest}</span>
                <span className="sr-only sm:hidden">{COPY.newRequest}</span>
              </Link>
            </nav>
          }
          actions={<SignOutButton />}
        />
        {children}
        <SiteFooter />
      </TooltipProvider>
    </ToastProvider>
  );
}
