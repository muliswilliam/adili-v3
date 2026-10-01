import { createFileRoute } from '@tanstack/react-router';

import { env } from '../../server/env.server';

/**
 * Stands in for object storage's presigned downloads while REVIEW_MOCK or ACCESS_MOCK is on: the
 * review mock's letter and attachment links and the access mock's representation attachments
 * point here. Serves a one-page placeholder PDF naming the file. Development and tests only;
 * everywhere else it is a 404.
 */
async function file(id: string): Promise<Response> {
  const { placeholderPdf } = await import('../../server/mock-pdf');
  const config = env();
  const title =
    (config.REVIEW_MOCK
      ? (await import('../../server/review/mock.server')).mockFileTitle(id)
      : null) ??
    (config.ACCESS_MOCK
      ? (await import('../../server/access/mock.server')).mockAccessFileTitle(id)
      : null);
  if (!title) return new Response(null, { status: 404 });
  return new Response(placeholderPdf([title, 'Placeholder file from the development mock.']), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${title.replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '-')}.pdf"`,
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
        import.meta.env.DEV &&
        process.env.NODE_ENV !== 'production' &&
        (env().REVIEW_MOCK || env().ACCESS_MOCK)
          ? file(params.id)
          : notFound(),
    },
  },
});
