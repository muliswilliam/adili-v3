import type { SessionUser } from '@adili/bff-auth';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

import { type Organisation, organisationOf, PLATFORM_TENANT } from '../components/organisation';
import { getBff } from './bff.server';
import { callDirectory, createDirectoryClient } from './directory/client';
import { fetchPrincipal, type PrincipalResult } from './directory.server';
import { env } from './env.server';

export interface Viewer {
  user: SessionUser;
  /** The platform's view of the caller, from the directory service. */
  directory: PrincipalResult;
}

/** The viewer and their organisation by name, for the dashboard's account card. */
export interface DashboardViewer extends Viewer {
  organisation: Organisation;
}

/** The signed-in user, or null. Runs on the server; tokens never leave it. */
export const getViewer = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Viewer | null> => (await loadViewer())?.viewer ?? null,
);

/** `getViewer` plus the name of the viewer's Commission (one more directory call). */
export const getDashboardViewer = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DashboardViewer | null> => {
    const loaded = await loadViewer();
    if (!loaded) return null;
    const { viewer, accessToken } = loaded;
    const tenant = viewer.directory.ok ? viewer.directory.principal.tenant : null;
    return {
      ...viewer,
      organisation: organisationOf(tenant, await commissionName(accessToken, tenant)),
    };
  },
);

async function loadViewer(): Promise<{ viewer: Viewer; accessToken: string } | null> {
  const session = await getBff().getSession(getRequest());
  if (!session) return null;
  return {
    viewer: {
      user: session.user,
      directory: await fetchPrincipal(env().DIRECTORY_API_URL, session.accessToken),
    },
    accessToken: session.accessToken,
  };
}

/**
 * The display name of the caller's own Commission (staff may read their own tenant), or null
 * when there is none to look up or the lookup fails: the dashboard then shows the key.
 */
async function commissionName(accessToken: string, tenant: string | null): Promise<string | null> {
  if (!tenant || tenant === PLATFORM_TENANT) return null;
  const client = createDirectoryClient({ baseUrl: env().DIRECTORY_API_URL, accessToken });
  const result = await callDirectory(() =>
    client.GET('/v1/commissions/{slug}', { params: { path: { slug: tenant } } }),
  );
  return result.ok ? result.data.name : null;
}
