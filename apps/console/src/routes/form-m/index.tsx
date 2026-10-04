import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { FormMWorkspaceView } from '../../components/form-m/form-m-workspace';
import { messages as m } from '../../components/form-m/messages';
import { signInRedirect } from '../../components/sign-in-redirect';
import { compileFormM, financialYear, getFormMWorkspace } from '../../server/form-m';
import type { FormMResult, FormMWorkspace } from '../../server/form-m.server';
import { SERVICE_UNAVAILABLE } from '../../server/service-call';

/** `?fy=2025` selects a financial year; without it the workspace opens the one needing work. */
const searchSchema = z.object({ fy: financialYear.optional().catch(undefined) });

export const Route = createFileRoute('/form-m/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
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

function FormMLoaded() {
  const result = Route.useLoaderData();
  const { capabilities, tenant } = Route.useRouteContext();
  const navigate = useNavigate({ from: '/form-m/' });
  // The layout shows why there is no workspace.
  if (!result) return null;
  return (
    <FormMWorkspaceView
      result={result}
      capabilities={capabilities}
      onSelect={(fy) => {
        void navigate({ search: { fy } });
      }}
      onCompile={(fy) =>
        tenant ? compileFormM({ data: { slug: tenant, fy } }) : Promise.resolve(SERVICE_UNAVAILABLE)
      }
    />
  );
}
