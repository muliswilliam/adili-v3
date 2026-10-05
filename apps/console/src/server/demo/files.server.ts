import { env } from '../env.server';
import { getDemoSwitch } from './demo.server';
import { DEMO_FILES } from './files';

/**
 * A demo file (`./files`) as an attachment, read from the mocks (`/demo/files/<name>`): the files
 * of the deployment the presenter is on, never a copy from another checkout (#679). Demo mode and
 * a signed-in demo account only; 404 otherwise, and for a name the panel does not offer.
 */
export async function demoFileResponse(request: Request, name: string): Promise<Response> {
  const file = DEMO_FILES.find((candidate) => candidate.name === name);
  const demo = getDemoSwitch();
  if (!file || !demo || !(await demo.currentDemoKey(request))) {
    return new Response(null, { status: 404 });
  }
  const { DEMO_MOCKS_URL } = env();
  const base = DEMO_MOCKS_URL.endsWith('/') ? DEMO_MOCKS_URL : `${DEMO_MOCKS_URL}/`;
  let upstream: Response;
  try {
    upstream = await fetch(new URL(`demo/files/${encodeURIComponent(file.name)}`, base), {
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return new Response('The integration mocks did not answer.', { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response('The integration mocks do not hold this file.', { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': `attachment; filename="${file.name}"`,
      'cache-control': 'no-store',
    },
  });
}
