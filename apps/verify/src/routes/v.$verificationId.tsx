import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';

import { ResultSkeleton } from '../components/result-skeleton';
import { ResultView } from '../components/result-view';
import { outcomeTitles, verifyMessages as copy } from '../copy';
import type { LookupOutcome } from '../lib/lookup-outcome';
import { resolveCode } from '../lib/resolve-code';
import { lookUpDocument } from '../server/lookup';

export const Route = createFileRoute('/v/$verificationId')({
  loader: async ({ params }): Promise<{ code: string; outcome: LookupOutcome }> => {
    const code = resolveCode(params.verificationId);
    switch (code.action) {
      case 'malformed':
        return { code: code.shown, outcome: { kind: 'malformed' } };
      case 'redirect':
        throw redirect({
          to: '/v/$verificationId',
          params: { verificationId: code.verificationId },
          replace: true,
        });
      case 'look-up':
        return {
          code: code.verificationId,
          outcome: await lookUpDocument({ data: { verificationId: code.verificationId } }),
        };
    }
  },
  // Every lookup is recorded and rate limited: ask again on each visit, never speculatively.
  staleTime: 0,
  gcTime: 0,
  pendingMs: 150,
  pendingComponent: ResultSkeleton,
  head: ({ loaderData }) => {
    const outcome = loaderData?.outcome;
    if (!outcome) return {};
    const key = outcome.kind === 'found' ? outcome.result.status : outcome.kind;
    return { meta: [{ title: copy.resultTitle(outcomeTitles[key]) }] };
  },
  component: VerificationResult,
});

function VerificationResult() {
  const { code, outcome } = Route.useLoaderData();
  const router = useRouter();
  return (
    <ResultView
      code={code}
      outcome={outcome}
      onRetry={() => {
        void router.invalidate();
      }}
    />
  );
}
