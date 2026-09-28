import type { SessionUser } from '@adili/bff-auth';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

import { type Organisation, organisationOf, PLATFORM_TENANT } from '../components/organisation';
import { getBff } from './bff.server';
import { callDirectory, createDirectoryClient, type RosterSummary } from './directory/client';
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
  /** Their Commission's roster summary, for the sidebar's flagged count; null when unknown. */
  roster: RosterSummary | null;
}

/** The signed-in user, or null. Runs on the server; tokens never leave it. */
export const getViewer = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Viewer | null> => (await loadViewer())?.viewer ?? null,
);

/** `getViewer` plus the viewer's Commission: its name and roster summary (one more call). */
export const getDashboardViewer = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DashboardViewer | null> => {
    const loaded = await loadViewer();
    if (!loaded) return null;
    const { viewer, accessToken } = loaded;
    const tenant = viewer.directory.ok ? viewer.directory.principal.tenant : null;
    const commission = await ownCommission(accessToken, tenant);
    return {
      ...viewer,
      organisation: organisationOf(tenant, commission?.name ?? null),
      roster: commission?.roster ?? null,
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
 * The caller's own Commission's name and roster summary (staff may read their own tenant), or
 * null when there is none to look up or the lookup fails: the dashboard then shows the key.
 */
async function ownCommission(
  accessToken: string,
  tenant: string | null,
): Promise<{ name: string; roster: RosterSummary } | null> {
  if (!tenant || tenant === PLATFORM_TENANT) return null;
  const client = createDirectoryClient({ baseUrl: env().DIRECTORY_API_URL, accessToken });
  const result = await callDirectory(() =>
    client.GET('/v1/commissions/{slug}', { params: { path: { slug: tenant } } }),
  );
  return result.ok ? { name: result.data.name, roster: result.data.roster } : null;
}
