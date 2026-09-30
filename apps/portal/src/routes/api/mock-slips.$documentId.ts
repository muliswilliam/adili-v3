import { createFileRoute } from '@tanstack/react-router';

import { env } from '../../server/env.server';

/**
 * Stands in for the documents service's presigned slip download while DECLARATIONS_MOCK
 * is on: the documents mock's `GET /v1/documents/{id}/download` points here. Serves a one-page
 * placeholder PDF naming the slip. Development and tests only; everywhere else it is a 404.
 */
async function slip(documentId: string): Promise<Response> {
  const { mockSlipFile } = await import('../../server/declarations/mock/acknowledgement');
  const file = mockSlipFile(documentId);
  if (!file) return new Response(null, { status: 404 });
  return new Response(file.pdf, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${file.fileName}"`,
    },
  });
}

function notFound(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 404 }));
}

export const Route = createFileRoute('/api/mock-slips/$documentId')({
  server: {
    handlers: {
      GET: ({ params }) =>
        // `import.meta.env.DEV` is `false` in production builds, so the bundler drops the mock
        // branch and the mock's chunk with it; keep the check inline for that to work.
        import.meta.env.DEV && process.env.NODE_ENV !== 'production' && env().DECLARATIONS_MOCK
          ? slip(params.documentId)
          : notFound(),
    },
  },
});
