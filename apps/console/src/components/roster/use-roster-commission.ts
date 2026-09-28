import { getRouteApi } from '@tanstack/react-router';

import type { Commission, DirectoryResult } from '../../server/directory/client';

const rosterLayout = getRouteApi('/roster');

/**
 * The viewer's own Commission with its roster summary, as the Roster layout loaded it for every
 * page under it; null outside the workspace.
 */
export function useRosterCommission(): DirectoryResult<Commission> | null {
  return rosterLayout.useLoaderData()?.commission ?? null;
}
