import { createFileRoute, redirect } from '@tanstack/react-router';

import { resolveCode } from '../lib/resolve-code';

/**
 * Where the index's code form lands when the browser submits it itself, before the page's
 * JavaScript has loaded: `/v?code=7Q4K-...` redirects to the result page for that code.
 */
export const Route = createFileRoute('/v/')({
  validateSearch: (search: Record<string, unknown>): { code?: string } =>
    typeof search.code === 'string' ? { code: search.code } : {},
  beforeLoad: ({ search }) => {
    const typed = search.code?.trim() ?? '';
    if (!typed) throw redirect({ to: '/' });
    const code = resolveCode(typed);
    throw redirect({
      to: '/v/$verificationId',
      params: { verificationId: code.action === 'malformed' ? code.shown : code.verificationId },
    });
  },
});
