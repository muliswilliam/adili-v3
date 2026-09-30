import { createFileRoute } from '@tanstack/react-router';

import { env } from '../../server/env.server';

/**
 * Stands in for object storage's presigned downloads while REVIEW_MOCK is on: the review mock's
 * letter and attachment links point here. Serves a one-page placeholder PDF naming the file.
 * Development and tests only; everywhere else it is a 404.
 */
async function file(id: string): Promise<Response> {
  const { mockFileTitle } = await import('../../server/review/mock.server');
  const { placeholderPdf } = await import('../../server/mock-pdf');
  const title = mockFileTitle(id);
  if (!title) return new Response(null, { status: 404 });
  return new Response(placeholderPdf([title, 'Placeholder file from the development mock.']), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${title.replace(/[^\w.-]+/g, '-')}.pdf"`,
    },
  });
}

function notFound(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 404 }));
}

export const Route = createFileRoute('/api/mock-files/$id')({
  server: {
    handlers: {
      GET: ({ params }) =>
        // `import.meta.env.DEV` is `false` in production builds, so the bundler drops the mock
        // branch and the mock's chunk with it; keep the check inline for that to work.
        import.meta.env.DEV && process.env.NODE_ENV !== 'production' && env().REVIEW_MOCK
          ? file(params.id)
          : notFound(),
    },
  },
});
