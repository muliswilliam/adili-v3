import { getBff } from './bff.server';
import { createDirectoryClient, type DirectoryClient } from './directory/client';
import { env } from './env.server';

/** Headers of the directory's answer that the browser gets as they are. */
const PASSED_HEADERS = ['content-type', 'content-disposition', 'content-length'];

/** What a console route needs to fetch a file from the directory for the signed-in user. */
export interface DirectoryAttachmentDeps {
  /** The signed-in user's access token, or null without a session. */
  accessToken: (request: Request) => Promise<string | null>;
  directory: (accessToken: string) => DirectoryClient;
}

export const defaultDirectoryAttachmentDeps: DirectoryAttachmentDeps = {
  accessToken: async (request) => (await getBff().getSession(request))?.accessToken ?? null,
  directory: (accessToken) =>
    createDirectoryClient({ baseUrl: env().DIRECTORY_API_URL, accessToken }),
};

/** An RFC 9457 problem answer from the console itself. */
export function problemResponse(status: number, title: string): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title, status }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

/**
 * A file the directory sends as an attachment, fetched with the signed-in user's token (the
 * call must use `parseAs: 'stream'`) and passed to the browser as it came: the body streamed,
 * the type, name and length kept, nothing cached. A refusal passes through as its problem; no
 * session is 401 and an unreachable directory 502.
 */
export async function directoryAttachment(
  request: Request,
  deps: DirectoryAttachmentDeps,
  fetchFile: (
    client: DirectoryClient,
    accessToken: string,
  ) => Promise<{ response: Response; error?: unknown }>,
): Promise<Response> {
  const accessToken = await deps.accessToken(request);
  if (!accessToken) return problemResponse(401, 'Sign in again');

  let outcome;
  try {
    outcome = await fetchFile(deps.directory(accessToken), accessToken);
  } catch {
    return problemResponse(502, 'The directory service did not respond');
  }
  const { response, error } = outcome;
  if (!response.ok) {
    // The client has read an error body already; send on the problem it parsed.
    return error
      ? new Response(JSON.stringify(error), {
          status: response.status,
          headers: { 'content-type': 'application/problem+json' },
        })
      : problemResponse(response.status, response.statusText || 'Error');
  }
  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const name of PASSED_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}
