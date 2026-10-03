import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { z } from 'zod';

import { downloadFrom } from '../../components/download';
import { FormMWorkspaceView } from '../../components/form-m/form-m-workspace';
import { messages as m } from '../../components/form-m/messages';
import {
  FormMSignOffView,
  type SignOffActions,
  type SignOffNavigation,
} from '../../components/form-m/sign-off';
import { goToSignIn, goToStepUp, signInRedirect } from '../../components/sign-in-redirect';
import {
  compileFormM,
  confirmFormM,
  financialYear,
  getFormMDocumentLink,
  getFormMWorkspace,
  getStepUpStatus,
  markFormMReviewed,
  saveFormMManualFields,
  saveFormMRemarks,
} from '../../server/form-m';
import type { FormMResult, FormMWorkspace } from '../../server/form-m.server';
import { SERVICE_UNAVAILABLE } from '../../server/service-call';

/**
 * `?fy=2025` selects a financial year; without it the workspace opens the one needing work.
 * `?stepUp=done|failed` is the marker the BFF adds on the way back from a step-up (spec 06).
 */
const searchSchema = z.object({
  fy: financialYear.optional().catch(undefined),
  stepUp: z.enum(['done', 'failed']).optional().catch(undefined),
});

export const Route = createFileRoute('/form-m/')({
  validateSearch: searchSchema,
  // The step-up marker is the page's to read, not the loader's: dropping it reloads nothing.
  loaderDeps: ({ search }) => ({ fy: search.fy }),
  loader: ({ deps, context, location }) => loadFormM(deps, context, location.href),
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: FormMLoading,
  component: FormMLoaded,
});

/**
 * The workspace for `?fy=`: none without the workspace, the viewer's own Commission's otherwise.
 * A year the Commission has no period for (a typed or stale link) redirects to the default year
 * under its own address rather than show another year under this one.
 */
export async function loadFormM(
  deps: { fy?: number },
  context: { workspace: unknown; tenant: string | null },
  href: string,
): Promise<FormMResult<FormMWorkspace> | null> {
  // The layout shows no workspace without the role; do not fetch one.
  if (!context.workspace) return null;
  // Form M is the viewer's own Commission's, the tenant of their session.
  if (!context.tenant) return SERVICE_UNAVAILABLE;
  const result = await getFormMWorkspace({ data: { slug: context.tenant, fy: deps.fy } });
  if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(href);
  if (result.ok && deps.fy !== undefined && result.data.fy !== deps.fy) {
    throw redirect({ to: '/form-m', search: {}, replace: true });
  }
  return result;
}

const noop = () => undefined;
const unavailable = () => Promise.resolve(SERVICE_UNAVAILABLE);

function FormMLoading() {
  const { capabilities } = Route.useRouteContext();
  return (
    <FormMWorkspaceView
      result={null}
      capabilities={capabilities}
      onSelect={noop}
      onCompile={unavailable}
    />
  );
}

/** The sign-off's calls to the reporting service, as the signed-in officer of `slug`. */
function signOffActions(slug: string): SignOffActions {
  return {
    saveRemarks: (fy, remarks) => saveFormMRemarks({ data: { slug, fy, remarks } }),
    saveManualFields: (fy, fields) => saveFormMManualFields({ data: { slug, fy, fields } }),
    markReviewed: (fy, designation) => markFormMReviewed({ data: { slug, fy, designation } }),
    confirm: (fy, idempotencyKey) => confirmFormM({ data: { slug, fy, idempotencyKey } }),
    stepUpFresh: async () => {
      const status = await getStepUpStatus();
      return status.ok ? status.fresh : null;
    },
    documentLink: (documentId) => getFormMDocumentLink({ data: { documentId } }),
  };
}

function FormMLoaded() {
  const result = Route.useLoaderData();
  const { stepUp } = Route.useSearch();
  const { capabilities, tenant, viewer } = Route.useRouteContext();
  const navigate = useNavigate({ from: '/form-m/' });
  const actions = useMemo(() => signOffActions(tenant ?? ''), [tenant]);
  const navigation = useMemo<SignOffNavigation>(
    () => ({
      stepUp: goToStepUp,
      signIn: goToSignIn,
      download: downloadFrom,
      clearStepUpMarker: () => {
        void navigate({ search: (search) => ({ fy: search.fy }), replace: true });
      },
    }),
    [navigate],
  );
  // The layout shows why there is no workspace.
  if (!result) return null;
  const onSelect = (fy: number) => {
    void navigate({ search: { fy } });
  };
  const onCompile = (fy: number) =>
    tenant ? compileFormM({ data: { slug: tenant, fy } }) : Promise.resolve(SERVICE_UNAVAILABLE);
  if (!result.ok) {
    return (
      <FormMWorkspaceView
        result={result}
        capabilities={capabilities}
        onSelect={onSelect}
        onCompile={onCompile}
      />
    );
  }
  return (
    // Keyed by year: edits and a confirmation in progress belong to the year they were for.
    <FormMSignOffView
      key={result.data.fy}
      result={result}
      capabilities={capabilities}
      viewerName={viewer.user.name}
      stepUpMarker={stepUp ?? null}
      actions={actions}
      navigation={navigation}
      onSelect={onSelect}
      onCompile={onCompile}
    />
  );
}
