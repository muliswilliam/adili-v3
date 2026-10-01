import { getRequest } from '@tanstack/react-start/server';

import { getBff } from './bff.server';
import {
  createDirectoryClient,
  type DirectoryClient,
  type DirectoryResult,
} from './directory/client';
import {
  createDeclarationsClient,
  type DeclarationsClient,
  type DeclarationsResult,
} from './declarations/client';
import {
  createDocumentsClient,
  type DocumentsClient,
  type DocumentsResult,
} from './documents/client';
import { env } from './env.server';

/** The answer for a request without a signed-in user; every service result type has it. */
export interface Unauthenticated {
  ok: false;
  error: { kind: 'unauthenticated' };
}

/**
 * Runs `work` with a service client that `createClient` makes for the signed-in user's access
 * token, or answers `unauthenticated` without calling it when there is no session.
 */
export async function withViewerClient<Client, Result>(
  createClient: (accessToken: string) => Client,
  work: (client: Client) => Promise<Result>,
): Promise<Result | Unauthenticated> {
  const session = await getBff().getSession(getRequest());
  if (!session) {
    return { ok: false, error: { kind: 'unauthenticated' } };
  }
  return work(createClient(session.accessToken));
}

/** Runs `work` with a directory client acting as the signed-in user. */
export function asViewer<T>(
  work: (client: DirectoryClient) => Promise<DirectoryResult<T>>,
): Promise<DirectoryResult<T>> {
  return withViewerClient(
    (accessToken) => createDirectoryClient({ baseUrl: env().DIRECTORY_API_URL, accessToken }),
    work,
  );
}

/** Runs `work` with a documents client acting as the signed-in user. */
export function asDocumentsViewer<T>(
  work: (client: DocumentsClient) => Promise<DocumentsResult<T>>,
): Promise<DocumentsResult<T>> {
  return withViewerClient(
    (accessToken) => createDocumentsClient({ baseUrl: env().DOCUMENTS_API_URL, accessToken }),
    work,
  );
}

/** Runs `work` with a declarations client acting as the signed-in user. */
export function asDeclarationsViewer<T>(
  work: (client: DeclarationsClient) => Promise<DeclarationsResult<T>>,
): Promise<DeclarationsResult<T>> {
  return withViewerClient(
    (accessToken) => createDeclarationsClient({ baseUrl: env().DECLARATIONS_API_URL, accessToken }),
    work,
  );
}
