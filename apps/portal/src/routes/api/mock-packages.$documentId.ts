import { createFileRoute } from '@tanstack/react-router';

import { env } from '../../server/env.server';

/**
 * Stands in for the documents service's presigned access package download while ACCESS_MOCK
 * is on: the access mock's `GET /v1/documents/{id}/download` points here. Serves a one-page
 * placeholder PDF naming the request. Development and tests only; everywhere else it is a 404.
 */
async function accessPackage(documentId: string): Promise<Response> {
  const { mockPackageFile } = await import('../../server/access/mock.server');
  const file = mockPackageFile(documentId);
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

export const Route = createFileRoute('/api/mock-packages/$documentId')({
  server: {
    handlers: {
      GET: ({ params }) =>
        // `import.meta.env.DEV` is `false` in production builds, so the bundler drops the mock
        // branch and the mock's chunk with it; keep the check inline for that to work.
        import.meta.env.DEV && process.env.NODE_ENV !== 'production' && env().ACCESS_MOCK
          ? accessPackage(params.documentId)
          : notFound(),
    },
  },
});
