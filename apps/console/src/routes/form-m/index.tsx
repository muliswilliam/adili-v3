import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { FormMWorkspaceView } from '../../components/form-m/form-m-workspace';
import { messages as m } from '../../components/form-m/messages';
import { signInRedirect } from '../../components/sign-in-redirect';
import { formMCapabilities } from '../../components/workspaces';
import { compileFormM, financialYear, getFormMWorkspace } from '../../server/form-m';
import type { FormMResult, FormMWorkspace } from '../../server/form-m.server';
import { SERVICE_UNAVAILABLE } from '../../server/service-call';

/** `?fy=2025` selects a financial year; without it the workspace opens the one needing work. */
const searchSchema = z.object({ fy: financialYear.optional().catch(undefined) });

export const Route = createFileRoute('/form-m/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context, location }): Promise<FormMResult<FormMWorkspace> | null> => {
    // The layout shows no workspace without the role; do not fetch one.
    if (!context.workspace) return null;
    // Form M is the viewer's own Commission's, the tenant of their session.
    if (!context.tenant) return SERVICE_UNAVAILABLE;
    const result = await getFormMWorkspace({ data: { slug: context.tenant, fy: deps.fy } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    // A year the Commission has no period for (a typed or stale link): open the default one
    // under its own address rather than show another year under this one.
    if (result.ok && deps.fy !== undefined && result.data.fy !== deps.fy) {
      throw redirect({ to: '/form-m', search: {}, replace: true });
    }
    return result;
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: FormMLoading,
  component: FormMLoaded,
});

const noop = () => undefined;
const unavailable = () => Promise.resolve(SERVICE_UNAVAILABLE);

function FormMLoading() {
  const { roles } = Route.useRouteContext();
  return (
    <FormMWorkspaceView
      result={null}
      capabilities={formMCapabilities(roles)}
      onSelect={noop}
      onCompile={unavailable}
    />
  );
}

function FormMLoaded() {
  const result = Route.useLoaderData();
  const { roles, tenant } = Route.useRouteContext();
  const navigate = useNavigate({ from: '/form-m/' });
  // The layout shows why there is no workspace.
  if (!result) return null;
  return (
    <FormMWorkspaceView
      result={result}
      capabilities={formMCapabilities(roles)}
      onSelect={(fy) => {
        void navigate({ search: { fy } });
      }}
      onCompile={(fy) =>
        tenant ? compileFormM({ data: { slug: tenant, fy } }) : Promise.resolve(SERVICE_UNAVAILABLE)
      }
    />
  );
}
