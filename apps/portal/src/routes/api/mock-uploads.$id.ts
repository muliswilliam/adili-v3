import { createFileRoute } from '@tanstack/react-router';

import { env } from '../../server/env.server';

/**
 * Stands in for object storage's presigned PUT while DECLARATIONS_DRAFTS_MOCK is on: the documents
 * mock's `uploadUrl` points here. Development and tests only; everywhere else it is a 404.
 */
async function receive(request: Request, id: string): Promise<Response> {
  const { receiveMockUpload } = await import('../../server/documents/mock.server');
  const bytes = await request.arrayBuffer();
  return receiveMockUpload(id, bytes.byteLength);
}

function notFound(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 404 }));
}

export const Route = createFileRoute('/api/mock-uploads/$id')({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        // `import.meta.env.DEV` is `false` in production builds, so the bundler drops the mock
        // branch and the mock's chunk with it; keep the check inline for that to work.
        import.meta.env.DEV &&
        process.env.NODE_ENV !== 'production' &&
        env().DECLARATIONS_DRAFTS_MOCK
          ? receive(request, params.id)
          : notFound(),
    },
  },
});
