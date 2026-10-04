import { createFileRoute } from '@tanstack/react-router';

import { env } from '../../server/env.server';

/**
 * Stands in for object storage's presigned downloads while REVIEW_MOCK, ACCESS_MOCK or
 * REPORTING_MOCK is on: the review mock's letter and attachment links, the access mock's
 * representation attachments, the EACC intake mock's Form M PDFs and receipts, the referrals
 * intake mock's evidence packages and the national report mock's NCR PDF point here, as do the
 * self-access mock's certified copies with `?inline`, served inline as object storage serves
 * issued PDFs. Serves a one-page placeholder PDF naming the file.
 * Development and tests only; everywhere else it is a 404.
 */
async function file(id: string, inline: boolean): Promise<Response> {
  const { placeholderPdf } = await import('../../server/mock-pdf');
  const config = env();
  const title =
    (config.REVIEW_MOCK
      ? (await import('../../server/review/mock.server')).mockFileTitle(id)
      : null) ??
    (config.ACCESS_MOCK
      ? (await import('../../server/access/mock.server')).mockAccessFileTitle(id)
      : null) ??
    (config.REPORTING_MOCK
      ? ((await import('../../server/reporting/eacc-mock.server')).mockReportingFileTitle(id) ??
        (await import('../../server/reporting/referral-intake-mock.server')).mockIntakeFileTitle(
          id,
        ))
      : null) ??
    (config.REPORTING_MOCK
      ? (await import('../../server/reporting/ncr-mock.server')).mockNcrFileTitle(id)
      : null);
  if (!title) return new Response(null, { status: 404 });
  return new Response(placeholderPdf([title, 'Placeholder file from the development mock.']), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${title.replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '-')}.pdf"`,
    },
  });
}

function notFound(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 404 }));
}

export const Route = createFileRoute('/api/mock-files/$id')({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        // `import.meta.env.DEV` is `false` in production builds, so the bundler drops the mock
        // branch and the mock's chunk with it; keep the check inline for that to work.
        import.meta.env.DEV &&
        process.env.NODE_ENV !== 'production' &&
        (env().REVIEW_MOCK || env().ACCESS_MOCK || env().REPORTING_MOCK)
          ? file(params.id, new URL(request.url).searchParams.has('inline'))
          : notFound(),
    },
  },
});
