import { getRequest } from '@tanstack/react-start/server';

import { getBff } from './bff.server';
import {
  createDirectoryClient,
  type DirectoryClient,
  type DirectoryResult,
} from './directory/client';
import { env } from './env.server';

/** Runs `work` with a directory client acting as the signed-in user. */
export async function asViewer<T>(
  work: (client: DirectoryClient) => Promise<DirectoryResult<T>>,
): Promise<DirectoryResult<T>> {
  const session = await getBff().getSession(getRequest());
  if (!session) {
    return { ok: false, error: { kind: 'unauthenticated' } };
  }
  return work(
    createDirectoryClient({
      baseUrl: env().DIRECTORY_API_URL,
      accessToken: session.accessToken,
    }),
  );
}
