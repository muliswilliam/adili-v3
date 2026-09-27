import type { SessionUser } from '@adili/bff-auth';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

import { getBff } from './bff.server';
import { type DeclarantAccountResult, loadDeclarantAccount } from './declarant.server';
import { directoryClient } from './directory/client.server';
import { fetchPrincipal, type PrincipalResult } from './directory.server';
import { env } from './env.server';

export interface Viewer {
  user: SessionUser;
  /** The platform's view of the caller, from the directory service. */
  directory: PrincipalResult;
  /** The declarant's Commissions, OFR and contacts, from `GET /v1/me/declarant`. */
  declarant: DeclarantAccountResult;
}

/** The signed-in user, or null. Runs on the server; tokens never leave it. */
export const getViewer = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Viewer | null> => {
    const session = await getBff().getSession(getRequest());
    if (!session) return null;
    const [directory, declarant] = await Promise.all([
      fetchPrincipal(env().DIRECTORY_API_URL, session.accessToken),
      loadDeclarantAccount(directoryClient(session.accessToken)),
    ]);
    return { user: session.user, directory, declarant };
  },
);
