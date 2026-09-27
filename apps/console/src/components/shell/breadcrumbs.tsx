import { Icon } from '@adili/ui';
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { Link, useMatches } from '@tanstack/react-router';

/** What a route's `crumb` sees of its match. */
export interface CrumbMatch {
  status: 'pending' | 'success' | 'error' | 'notFound' | 'redirected';
  loaderData?: unknown;
  context?: unknown;
  /** Whether this is the page being shown (the last crumb). */
  isLeaf: boolean;
}

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** Breadcrumb label in the console top bar; null leaves the route out of the trail. */
    crumb?: string | ((match: CrumbMatch) => string | null);
  }
}

interface Crumb {
  id: string;
  label: string;
  to: string;
}

function useCrumbs(): Crumb[] {
  const matches = useMatches();
  // The leaf is the deepest route that names itself (index routes usually don't).
  const named = matches.filter((match) => match.staticData.crumb !== undefined);
  return named.flatMap((match, index) => {
    const { crumb } = match.staticData;
    const label =
      typeof crumb === 'function'
        ? crumb({
            status: match.status,
            loaderData: match.loaderData,
            context: match.context,
            isLeaf: index === named.length - 1,
          })
        : crumb;
    return label ? [{ id: match.id, label, to: match.pathname }] : [];
  });
}

/** The trail for the current page, from each matched route's `staticData.crumb`. */
export function Breadcrumbs() {
  const crumbs = useCrumbs();
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-[13.5px] text-muted-foreground">
        {crumbs.map((crumb, index) =>
          index === crumbs.length - 1 ? (
            <li key={crumb.id} className="min-w-0">
              <span aria-current="page" className="block truncate font-medium text-foreground">
                {crumb.label}
              </span>
            </li>
          ) : (
            <li key={crumb.id} className="flex shrink-0 items-center gap-1.5">
              <Link
                to={crumb.to}
                className="rounded-sm outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {crumb.label}
              </Link>
              <Icon icon={ArrowRight01Icon} className="size-3.5" />
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}
