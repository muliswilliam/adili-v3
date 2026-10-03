import { createFileRoute } from '@tanstack/react-router';

import { env } from '../../server/env.server';

/**
 * Stands in for the documents service's presigned letter download while REVIEW_MOCK is on: the
 * review mock's `letterDownloadUrl` and decision letter links point here. Serves a one-page
 * placeholder PDF naming the clarification or the decision. Development and tests only;
 * everywhere else it is a 404.
 */
async function letter(id: string): Promise<Response> {
  const { mockClarification, mockDecisionLetter } = await import('../../server/review/mock.server');
  const { placeholderPdf } = await import('../../server/mock-pdf');
  const decision = mockDecisionLetter(id);
  if (decision) {
    return new Response(
      placeholderPdf([
        `Decision letter ${decision.reference}`,
        `${decision.commission.name} - declaration ${decision.declarationReference}`,
        'Placeholder letter from the development mock.',
      ]),
      {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${decision.reference}.pdf"`,
        },
      },
    );
  }
  const clarification = mockClarification(id);
  if (!clarification?.reference) return new Response(null, { status: 404 });
  const lines = [
    `Request for clarification ${clarification.reference}`,
    `${clarification.commission.name} - declaration ${clarification.declarationReference}`,
    clarification.letter?.status === 'revoked'
      ? 'Withdrawn: issued in error. No response is needed.'
      : `Respond on Adili Online by ${clarification.dueAt?.slice(0, 10) ?? ''}.`,
    'Placeholder letter from the development mock.',
  ];
  return new Response(placeholderPdf(lines), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${clarification.reference}.pdf"`,
    },
  });
}

function notFound(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 404 }));
}

export const Route = createFileRoute('/api/mock-letters/$id')({
  server: {
    handlers: {
      GET: ({ params }) =>
        // `import.meta.env.DEV` is `false` in production builds, so the bundler drops the mock
        // branch and the mock's chunk with it; keep the check inline for that to work.
        import.meta.env.DEV && process.env.NODE_ENV !== 'production' && env().REVIEW_MOCK
          ? letter(params.id)
          : notFound(),
    },
  },
});
