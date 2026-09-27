import { Badge, Button, cn, Icon, LogoWordmark } from '@adili/ui';
import { Logout01Icon, Menu01Icon } from '@hugeicons/core-free-icons';
import { Link, useLocation } from '@tanstack/react-router';
import { type ReactNode, useEffect, useRef } from 'react';

import { Breadcrumbs } from './breadcrumbs';
import { seniorRoleLabel } from '../roles';
import { initials, navFor } from './nav';

export interface ConsoleShellProps {
  userName: string;
  roles: readonly string[];
  children: ReactNode;
}

/**
 * Signed-in console layout (the kit's `consoleShell`): a 248px sidebar from 1024px, and below
 * that a menu button in the top bar that opens the same sidebar as a drawer.
 */
export function ConsoleShell({ userName, roles, children }: ConsoleShellProps) {
  const drawer = useRef<HTMLDialogElement>(null);
  const pathname = useLocation({ select: (location) => location.pathname });

  // Following a link in the drawer closes it.
  useEffect(() => {
    drawer.current?.close();
  }, [pathname]);

  const sidebar = <Sidebar userName={userName} roles={roles} />;
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto border-r bg-muted/60 px-3 py-4 lg:flex">
        {sidebar}
      </aside>
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
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2.5 border-b bg-background/88 px-4 backdrop-blur-md backdrop-saturate-[1.4] lg:px-7">
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
            className="shrink-0 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:hidden"
          >
            <LogoWordmark className="h-5" />
          </Link>
          <Breadcrumbs />
        </header>
        {children}
      </div>
    </div>
  );
}

function Sidebar({ userName, roles }: { userName: string; roles: readonly string[] }) {
  const groups = navFor(roles);
  const role = seniorRoleLabel(roles);
  return (
    <>
      <Link
        to="/"
        aria-label="Dials console home"
        className="mb-2 flex w-fit items-center gap-2 rounded-sm px-2 pt-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
                  <Link
                    to={item.to}
                    className={cn(
                      'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-secondary-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      'data-[status=active]:bg-card data-[status=active]:text-foreground data-[status=active]:shadow-card',
                    )}
                  >
                    <Icon icon={item.icon} className="size-[17px]" />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      ))}
      <div className="mt-auto flex items-center gap-2.5 border-t pt-3 text-[13px]">
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-br from-brand/45 to-brand text-[11.5px] font-semibold text-primary-foreground"
        >
          {initials(userName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{userName}</p>
          {role ? <p className="truncate text-xs text-muted-foreground">{role}</p> : null}
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
