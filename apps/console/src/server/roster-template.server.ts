import { isRosterTemplateFormat } from '../components/roster/template-download';
import { getBff } from './bff.server';
import { createDirectoryClient, type DirectoryClient } from './directory/client';
import { env } from './env.server';

/** Headers of the directory's answer that the browser gets as they are. */
const PASSED_HEADERS = ['content-type', 'content-disposition', 'content-length'];

export interface RosterTemplateDeps {
  /** The signed-in user's access token, or null without a session. */
  accessToken: (request: Request) => Promise<string | null>;
  directory: (accessToken: string) => DirectoryClient;
}

const defaultDeps: RosterTemplateDeps = {
  accessToken: async (request) => (await getBff().getSession(request))?.accessToken ?? null,
  directory: (accessToken) =>
    createDirectoryClient({ baseUrl: env().DIRECTORY_API_URL, accessToken }),
};

function problem(status: number, title: string): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title, status }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

/**
 * `GET /roster/template?format=csv|xlsx`: the roster template from the directory
 * (`getRosterTemplate`), fetched with the signed-in user's token and passed through as the
 * attachment the directory sends. The directory decides who may download it (403 otherwise).
 */
export async function rosterTemplateResponse(
  request: Request,
  deps: RosterTemplateDeps = defaultDeps,
): Promise<Response> {
  const format = new URL(request.url).searchParams.get('format');
  if (!isRosterTemplateFormat(format)) return problem(400, 'Unknown template format');
  const accessToken = await deps.accessToken(request);
  if (!accessToken) return problem(401, 'Sign in again');

  let outcome;
  try {
    outcome = await deps.directory(accessToken).GET('/v1/roster/template', {
      params: { query: { format } },
      parseAs: 'stream',
    });
  } catch {
    return problem(502, 'The directory service did not respond');
  }
  const { response, error } = outcome;
  if (!response.ok) {
    // The client has read an error body already; send on the problem it parsed.
    return error
      ? new Response(JSON.stringify(error), {
          status: response.status,
          headers: { 'content-type': 'application/problem+json' },
        })
      : problem(response.status, response.statusText || 'Error');
  }
  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const name of PASSED_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}
