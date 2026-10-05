import { Button, Card, EmptyState, Icon } from '@adili/ui';
import { AlertCircleIcon, Home01Icon, RefreshIcon, Search01Icon } from '@hugeicons/core-free-icons';
import { type ErrorComponentProps, Link, useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';

/** A page-width frame for a route that has nothing else to show. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto grid w-full max-w-[880px] flex-1 content-start px-4 pt-6 pb-16 sm:px-7 sm:pt-10">
      <Card className="p-0 sm:p-0">{children}</Card>
    </main>
  );
}

/**
 * The router's default error boundary: a route threw while loading or rendering. Try again
 * clears the boundary and reruns the loaders; the details are shown in development only.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <Frame>
      <EmptyState
        className="py-14"
        tone="destructive"
        icon={<Icon icon={AlertCircleIcon} />}
        title="Something went wrong"
        description="This page could not be shown. Try again, or go back to the start."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                reset();
                void router.invalidate();
              }}
            >
              <Icon icon={RefreshIcon} />
              Try again
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/">
                <Icon icon={Home01Icon} />
                Go to the start
              </Link>
            </Button>
          </div>
        }
      />
      {import.meta.env.DEV ? (
        <pre className="mx-5 mb-5 overflow-auto rounded-tile bg-muted p-3 text-left text-xs text-muted-foreground">
          {error instanceof Error ? (error.stack ?? error.message) : String(error)}
        </pre>
      ) : null}
    </Frame>
  );
}

/** The router's default not-found page, for a path no route matches. */
export function RouteNotFound() {
  return (
    <Frame>
      <EmptyState
        className="py-14"
        icon={<Icon icon={Search01Icon} />}
        title="Page not found"
        description="There is nothing at this address. Check the link, or go back to the start."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/">
              <Icon icon={Home01Icon} />
              Go to the start
            </Link>
          </Button>
        }
      />
    </Frame>
  );
}
