import { Button, EmptyState, Icon } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router';

import { LadderDetailView, type LadderDecisions } from '../../components/actions/ladder-detail';
import { en as m } from '../../components/actions/messages';
import { LoadError } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { signInRedirect } from '../../components/sign-in-redirect';
import {
  approveLadderStep,
  declineLadderStep,
  getLadder,
  getStepLetterLink,
  restartDeclinedLadder,
} from '../../server/actions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The crumb: the declarant's name, or "Actions" while the ladder cannot be named. */
function crumbOf(loaderData: unknown): string {
  if (typeof loaderData !== 'object' || loaderData === null || !('result' in loaderData)) {
    return m.title;
  }
  const result = loaderData.result as { ok: boolean; data?: { declarantName?: string } };
  return (result.ok ? result.data?.declarantName : null) ?? m.title;
}

const decisions: LadderDecisions = {
  approve: (actionId, idempotencyKey) => approveLadderStep({ data: { actionId, idempotencyKey } }),
  decline: (actionId, note, idempotencyKey) =>
    declineLadderStep({ data: { actionId, note, idempotencyKey } }),
  restart: (ladderId, idempotencyKey) =>
    restartDeclinedLadder({ data: { ladderId, idempotencyKey } }),
  letterLink: (documentId) => getStepLetterLink({ data: { documentId } }),
};

/** A ladder with its steps, and the decisions on it (spec 08 FE-5, S5 to S11). */
export const Route = createFileRoute('/actions/$ladderId')({
  loader: async ({ params, context, location }) => {
    // The layout explains a failed access read.
    if (!context.viewer.directory.ok) return null;
    // A ladder is missing to anyone outside review.
    if (!context.workspace || !UUID.test(params.ladderId)) throw notFound();
    const result = await getLadder({ data: { ladderId: params.ladderId } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    if (!result.ok && result.error.kind === 'problem') {
      const { status } = result.error.problem;
      if (status === 404 || status === 403) throw notFound();
    }
    return { result, now: new Date().toISOString() };
  },
  staticData: { crumb: ({ loaderData }) => crumbOf(loaderData) },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  component: LadderRoute,
  notFoundComponent: () => (
    <Page narrow>
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title={m.notFoundTitle}
        description={m.notFoundBody}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/actions">{m.backToActions}</Link>
          </Button>
        }
      />
    </Page>
  ),
});

function LadderRoute() {
  const load = Route.useLoaderData();
  const { supervisor } = Route.useRouteContext();
  const router = useRouter();
  if (!load) return null;
  if (!load.result.ok) {
    return (
      <Page narrow>
        <PageHead title={m.title} />
        <LoadError title={m.detailErrorTitle} detail={m.loadErrorDetail} retryLabel={m.tryAgain} />
      </Page>
    );
  }
  return (
    <LadderDetailView
      ladder={load.result.data}
      now={load.now}
      supervisor={supervisor}
      decisions={decisions}
      onChanged={() => {
        void router.invalidate();
      }}
    />
  );
}
