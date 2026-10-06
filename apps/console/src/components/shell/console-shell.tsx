import {
  Avatar,
  Badge,
  Button,
  cn,
  focusRing,
  Icon,
  LogoWordmark,
  SiteFooter,
  ThemeSwitcher,
} from '@adili/ui';
import { Logout01Icon, Menu01Icon } from '@hugeicons/core-free-icons';
import { Link, useLocation } from '@tanstack/react-router';
import { type ReactNode, useEffect, useRef } from 'react';

import { Breadcrumbs } from './breadcrumbs';
import { ShellDemoBar } from '../demo/demo-context';
import { DemoPanel } from '../demo/demo-panel';
import { type Organisation, organisationLabel } from '../organisation';
import { seniorRoleLabel } from '../roles';
import { formatNumber } from '../format';
import { activeNavHref, type NavHref, navFor } from './nav';

/** A count on a sidebar entry, e.g. flagged officers on Roster; `label` reads it out. */
export interface NavCount {
  count: number;
  /** For screen readers, e.g. "3 flagged". */
  label: string;
}

export type NavCounts = Partial<Record<NavHref, NavCount>>;

export interface ConsoleShellProps {
  userName: string;
  roles: readonly string[];
  /** The signed-in person's Commission (or the platform team), under their role in the sidebar. */
  organisation?: Organisation;
  /** Counts shown on sidebar entries (the kit's `.cnav .count`); none are shown for 0. */
  navCounts?: NavCounts;
  children: ReactNode;
}

/**
 * Signed-in console layout (the kit's `consoleShell`): a 248px sidebar from 1024px, and below
 * that a menu button in the top bar that opens the same sidebar as a drawer. The site footer
 * closes the main column; the sidebar's background runs the page's full height, and its contents
 * keep to the window however far the page scrolls.
 */
export function ConsoleShell({
  userName,
  roles,
  organisation,
  navCounts,
  children,
}: ConsoleShellProps) {
  const drawer = useRef<HTMLDialogElement>(null);
  const pathname = useLocation({ select: (location) => location.pathname });

  // Following a link in the drawer closes it.
  useEffect(() => {
    drawer.current?.close();
  }, [pathname]);

  const sidebar = (
    <Sidebar
      userName={userName}
      roles={roles}
      organisation={organisation}
      pathname={pathname}
      navCounts={navCounts}
    />
  );
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      {/* The grid cell runs the page's full height and carries the sidebar's background, so it
          never stops short of a page longer than the window (a full-page screenshot); the aside
          inside keeps to the window as the page scrolls. */}
      <div data-sidebar-column className="hidden border-r bg-muted/60 lg:block">
        <aside className="sticky top-0 flex h-dvh flex-col overflow-y-auto px-3 py-4">
          {sidebar}
        </aside>
      </div>
      {/* A modal dialog traps focus, closes on Escape and hands focus back to the menu button. */}
      <dialog
        ref={drawer}
        aria-label="Menu"
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[280px] max-w-[calc(100vw-3rem)] flex-col overflow-y-auto bg-background px-3 py-4 text-foreground shadow-pop backdrop:bg-scrim open:flex lg:hidden"
        onClick={(event) => {
          // Clicks on the backdrop land on the dialog itself.
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        {sidebar}
      </dialog>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2.5 border-b bg-background px-4 lg:px-7">
          <Button
            variant="ghost"
            size="icon"
            className="-ml-1.5 lg:hidden"
            aria-label="Menu"
            aria-haspopup="dialog"
            onClick={() => drawer.current?.showModal()}
          >
            <Icon icon={Menu01Icon} className="size-[19px]" />
          </Button>
          <Link
            to="/"
            aria-label="Dials console home"
            className={cn(focusRing, 'shrink-0 rounded-sm lg:hidden')}
          >
            <LogoWordmark className="h-5" />
          </Link>
          <Breadcrumbs />
          <div className="ml-auto flex items-center gap-1.5">
            <DemoPanel />
            <ShellDemoBar />
            <ThemeSwitcher />
          </div>
        </header>
        {children}
        {/* Lined up with a page's content (`Page`). */}
        <SiteFooter
          className="mt-auto"
          contentClassName="max-w-[1280px] sm:px-4 min-[700px]:px-7!"
        />
      </div>
    </div>
  );
}

function Sidebar({
  userName,
  roles,
  organisation,
  pathname,
  navCounts,
}: {
  userName: string;
  roles: readonly string[];
  organisation?: Organisation;
  pathname: string;
  navCounts?: NavCounts;
}) {
  const groups = navFor(roles);
  const active = activeNavHref(groups, pathname);
  const role = seniorRoleLabel(roles);
  const organisationName = organisation ? organisationLabel(organisation) : null;
  return (
    <>
      <Link
        to="/"
        aria-label="Dials console home"
        className={cn(focusRing, 'mb-2 flex w-fit items-center gap-2 rounded-sm px-2 pt-1')}
      >
        <LogoWordmark className="h-[22px]" />
        <Badge className="h-5 px-2 text-[11px]">Console</Badge>
      </Link>
      {groups.map((group) => (
        <div key={group.label}>
          <h2 className="px-2.5 pt-3.5 pb-1.5 text-[11.5px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
            {group.label}
          </h2>
          <nav aria-label={group.label}>
            <ul className="grid gap-1">
              {group.items.map((item) => (
                <li key={item.label}>
                  {/*
                    The deepest entry containing the page is current (API access, not also
                    Roster); the router's own active state would mark both.
                  */}
                  <Link
                    to={item.to}
                    activeOptions={{ exact: true }}
                    aria-current={item.to === active ? 'page' : undefined}
                    className={cn(
                      focusRing,
                      'group flex min-h-9 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-secondary-foreground hover:bg-muted hover:text-foreground',
                      'aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-card',
                    )}
                  >
                    <Icon icon={item.icon} className="size-[17px]" />
                    {item.label}
                    <Count value={navCounts?.[item.to]} />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      ))}
      <div className="mt-auto flex items-center gap-2.5 border-t pt-3 text-[13px]">
        <Avatar name={userName} current className="size-7 text-[11.5px] font-semibold" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{userName}</p>
          {role ? <p className="truncate text-xs text-muted-foreground">{role}</p> : null}
          {organisationName ? (
            <p className="line-clamp-2 text-xs text-muted-foreground" title={organisationName}>
              {organisationName}
            </p>
          ) : null}
        </div>
        {/* A form POST so logout cannot be triggered by a cross-site link. */}
        <form method="post" action="/auth/logout">
          <Button type="submit" variant="ghost" size="icon" aria-label="Sign out" title="Sign out">
            <Icon icon={Logout01Icon} className="size-[17px]" />
          </Button>
        </form>
      </div>
    </>
  );
}

/** The kit's nav count: a muted pill, brand on the current entry. Hidden for none. */
function Count({ value }: { value: NavCount | undefined }) {
  if (!value || value.count <= 0) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-foreground/10 px-1.5 text-[11.5px] font-medium text-secondary-foreground tabular-nums group-aria-[current=page]:bg-brand group-aria-[current=page]:text-primary-foreground"
      >
        {formatNumber(value.count)}
      </span>
      <span className="sr-only">{`, ${value.label}`}</span>
    </>
  );
}
