import { createFileRoute } from '@tanstack/react-router';

import { env } from '../../server/env.server';

/**
 * Stands in for object storage's presigned downloads while REVIEW_MOCK, ACCESS_MOCK or
 * REPORTING_MOCK is on: the review mock's letter and attachment links, the access mock's
 * representation attachments, the Form M workspace and EACC intake mocks' Form M PDFs and
 * receipts, the referrals intake mock's evidence packages and the national report mock's NCR PDF
 * point here, as do the self-access mock's certified copies with `?inline`, served inline as
 * object storage serves issued PDFs. Serves a one-page placeholder PDF naming the file.
 * Development and tests only; everywhere else it is a 404.
 */
async function file(id: string, inline: boolean): Promise<Response> {
  const { placeholderPdf } = await import('../../server/mock-pdf');
  const title = await mockFileTitle(id);
  if (!title) return new Response(null, { status: 404 });
  return new Response(placeholderPdf([title, 'Placeholder file from the development mock.']), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${title.replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '-')}.pdf"`,
    },
  });
}

/** The mocks that issue files, each asked only while it is on. */
const MOCK_FILES: readonly {
  on: (config: ReturnType<typeof env>) => boolean;
  title: (id: string) => Promise<string | null>;
}[] = [
  {
    on: (config) => config.REVIEW_MOCK,
    title: async (id) => (await import('../../server/review/mock.server')).mockFileTitle(id),
  },
  {
    on: (config) => config.ACCESS_MOCK,
    title: async (id) => (await import('../../server/access/mock.server')).mockAccessFileTitle(id),
  },
  {
    on: (config) => config.REPORTING_MOCK,
    title: async (id) =>
      (await import('../../server/reporting/mock.server')).mockReportingFileTitle(id),
  },
  {
    on: (config) => config.REPORTING_MOCK,
    title: async (id) =>
      (await import('../../server/reporting/eacc-mock.server')).mockReportingFileTitle(id),
  },
  {
    on: (config) => config.REPORTING_MOCK,
    title: async (id) =>
      (await import('../../server/reporting/referral-intake-mock.server')).mockIntakeFileTitle(id),
  },
  {
    on: (config) => config.REPORTING_MOCK,
    title: async (id) =>
      (await import('../../server/reporting/ncr-mock.server')).mockNcrFileTitle(id),
  },
];

/** The file's name in the first mock that knows it, or null. */
async function mockFileTitle(id: string): Promise<string | null> {
  const config = env();
  for (const mock of MOCK_FILES) {
    if (!mock.on(config)) continue;
    const title = await mock.title(id);
    if (title) return title;
  }
  return null;
}

/** Whether any mock that issues files is on. */
const anyMockOn = () => MOCK_FILES.some((mock) => mock.on(env()));

function notFound(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 404 }));
}

export const Route = createFileRoute('/api/mock-files/$id')({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        // `import.meta.env.DEV` is `false` in production builds, so the bundler drops the mock
        // branch and the mock's chunk with it; keep the check inline for that to work.
        import.meta.env.DEV && process.env.NODE_ENV !== 'production' && anyMockOn()
          ? file(params.id, new URL(request.url).searchParams.has('inline'))
          : notFound(),
    },
  },
});
