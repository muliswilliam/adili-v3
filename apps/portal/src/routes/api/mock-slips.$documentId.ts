import { createFileRoute } from '@tanstack/react-router';

import { env } from '../../server/env.server';

/**
 * Stands in for the documents service's presigned slip download while DECLARATIONS_DRAFTS_MOCK
 * is on: the declarations mock's acknowledgement `downloadUrl` points here. Serves a one-page
 * placeholder PDF naming the slip. Development and tests only; everywhere else it is a 404.
 */
async function slip(documentId: string): Promise<Response> {
  const { mockSlip } = await import('../../server/declarations/mock/acknowledgement');
  const { placeholderPdf } = await import('../../server/mock-pdf');
  const issued = mockSlip(documentId);
  if (!issued) return new Response(null, { status: 404 });
  const lines = [
    `Acknowledgement slip ${issued.reference}, version ${String(issued.version)}`,
    `Verification code ${issued.verificationId}`,
    'Placeholder slip from the development mock.',
  ];
  return new Response(placeholderPdf(lines), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${issued.reference}-v${String(issued.version)}.pdf"`,
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
        import.meta.env.DEV &&
        process.env.NODE_ENV !== 'production' &&
        env().DECLARATIONS_DRAFTS_MOCK
          ? slip(params.documentId)
          : notFound(),
    },
  },
});
