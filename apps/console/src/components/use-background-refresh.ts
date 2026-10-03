import { useToast } from '@adili/ui';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import { useRefreshOnFocus } from './use-refresh-on-focus';

/**
 * Reads one route's loader again in the background, keeping what it shows meanwhile: when the
 * window regains focus (quietly) and on `refresh`, which toasts `announcement` once that read has
 * landed and `succeeded` says its data is good (a loader that folds a failed read into its data
 * still resolves). Never while the route is loading already, nor before it has `data` to show.
 *
 * The route's match is marked to load again; the router loads the stale matches around it too (a
 * load at the same URL reloads them), so a layout that should keep its data needs a `staleTime`.
 */
export function useBackgroundRefresh<Data>({
  routeId,
  data,
  succeeded,
  announcement,
}: {
  routeId: string;
  /** The route's loader data on show; null while there is none (the first load). */
  data: Data | null;
  succeeded: (data: Data) => boolean;
  announcement: string;
}): { refresh: () => void; refreshing: boolean } {
  const router = useRouter();
  const { toast } = useToast();
  const refreshing = useRouterState({
    select: (state) =>
      state.matches.some((match) => match.routeId === routeId && match.isFetching !== false),
  });
  // The data on show when Refresh was pressed, until the read it asked for lands. Judged by the
  // data, not the fetch flag: the router can publish that a load ended a render before its data.
  const announcing = useRef<{ before: Data } | null>(null);

  useEffect(() => {
    const asked = announcing.current;
    if (!asked || refreshing || data === null || data === asked.before) return;
    announcing.current = null;
    if (succeeded(data)) toast({ title: announcement });
  }, [refreshing, data, succeeded, toast, announcement]);

  const reload = (): boolean => {
    if (data === null || refreshing) return false;
    void router.invalidate({ filter: (match) => match.routeId === routeId });
    return true;
  };
  useRefreshOnFocus(() => void reload());

  return {
    refreshing,
    refresh: () => {
      const before = data;
      if (before !== null && reload()) announcing.current = { before };
    },
  };
}
