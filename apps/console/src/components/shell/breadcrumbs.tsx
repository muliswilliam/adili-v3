import { cn, focusRing, Icon } from '@adili/ui';
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

/**
 * A route's crumb with links to the pages above it that the route tree does not nest it under,
 * e.g. a clarification's case (`/review/cases/$caseId` is a sibling of its clarifications).
 */
export interface CrumbTrail {
  before: { label: string; to: string }[];
  label: string;
}

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** Breadcrumb label in the console top bar; null leaves the route out of the trail. */
    crumb?: string | ((match: CrumbMatch) => string | CrumbTrail | null);
  }
}

interface Crumb {
  id: string;
  label: string;
  to: string;
}

/** Home (`/`) is a leaf, not a parent of the other pages, so the trail adds it in front (#743). */
const HOME: Crumb = { id: 'home', label: 'Home', to: '/' };

function useCrumbs(): Crumb[] {
  const matches = useMatches();
  // The leaf is the deepest route that names itself (index routes usually don't).
  const named = matches.filter((match) => match.staticData.crumb !== undefined);
  const crumbs = named.flatMap((match, index) => {
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
    if (!label) return [];
    if (typeof label === 'string') return [{ id: match.id, label, to: match.pathname }];
    return [
      ...label.before.map((link) => ({ id: `${match.id}:${link.to}`, ...link })),
      { id: match.id, label: label.label, to: match.pathname },
    ];
  });
  if (crumbs.length === 0 || crumbs[0]?.to === HOME.to) return crumbs;
  return [HOME, ...crumbs];
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
            // Home stays whole; the crumbs between it and the page give way on a narrow bar.
            <li
              key={crumb.id}
              className={cn('flex items-center gap-1.5', crumb === HOME ? 'shrink-0' : 'min-w-0')}
            >
              <Link
                to={crumb.to}
                className={cn(focusRing, 'truncate rounded-sm hover:text-foreground')}
              >
                {crumb.label}
              </Link>
              <Icon icon={ArrowRight01Icon} className="size-3.5 shrink-0" />
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}
