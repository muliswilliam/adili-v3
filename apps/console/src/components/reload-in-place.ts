import { useLocation, useMatch, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

/** How long a finished load's data may take to show before an older answer counts as stale. */
const SETTLE_MS = 100;

/** What a list's loader returns beside its data: the search it loaded for (`location.searchStr`). */
export interface LoadedFor {
  loadedFor: string;
}

/**
 * Whether the route rendering this component is loading again in place: a list whose filters or
 * page are in the URL, after one of them changed.
 *
 * Such a route keeps its search out of `loaderDeps`: a new set of deps is a new match, which the
 * router replaces with its pending page once the loader takes over a second (the content
 * flashing back to skeletons, the search box losing focus mid-word). Instead it sets
 * `shouldReload: true` and its loader reads the search off the `location` it is loading for, so a
 * change reloads the same match in the background. The page stays mounted with the new search
 * already in hand; this tells it to show the list as loading meanwhile.
 *
 * The match being the same, a change made while a load is under way does not load again: the
 * router hands the load already running to the newer navigation, so its answer is for the older
 * search. Given what the loader says it `loadedFor`, this loads again for the search on show
 * (`current`, the location's by default) once the router settles, and counts as loading until
 * then, so the list never shows the answer to an older search.
 */
export function useReloadingInPlace(loaded?: LoadedFor | null, current?: string): boolean {
  const fetching = useMatch({ strict: false, select: (match) => match.isFetching !== false });
  const searchStr = useLocation({ select: (location) => location.searchStr });
  const idle = useRouterState({ select: (state) => state.status === 'idle' });
  const router = useRouter();
  const stale = loaded != null && loaded.loadedFor !== (current ?? searchStr);
  // Once nothing loads (a reload in place runs in the background of an idle router), and the
  // answer had a moment to arrive: the router may publish the end of a load before its data.
  const settled = idle && !fetching;
  useEffect(() => {
    if (!stale || !settled) return;
    const timer = setTimeout(() => void router.invalidate(), SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [stale, settled, router]);
  return fetching || stale;
}
