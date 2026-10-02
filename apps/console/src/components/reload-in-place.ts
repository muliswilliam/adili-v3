import { useMatch } from '@tanstack/react-router';

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
 */
export function useReloadingInPlace(): boolean {
  return useMatch({ strict: false, select: (match) => match.isFetching !== false });
}
