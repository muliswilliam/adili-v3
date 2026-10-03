import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { IntakeDashboard } from '../../../components/eacc-intake/intake-dashboard';
import { messages as m } from '../../../components/eacc-intake/messages';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { type IntakePage, getEaccIntake } from '../../../server/eacc-intake';
import { financialYear } from '../../../server/form-m';

/**
 * `?fy=` the year on show (else the last that ended); `status`, `outliers` and `q` filter it and
 * `page` pages it, in the browser: the year's intake is read once per year.
 */
const searchSchema = z.object({
  fy: financialYear.optional().catch(undefined),
  status: z
    .enum(['not-reported', 'submitted-on-time', 'submitted-late'])
    .optional()
    .catch(undefined),
  outliers: z.boolean().optional().catch(undefined),
  q: z.string().max(100).optional().catch(undefined),
  page: z.int().min(1).optional().catch(undefined),
});

export const Route = createFileRoute('/eacc/reports/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ fy: search.fy }),
  loader: async ({ deps, context, location }): Promise<IntakePage | null> => {
    // The layout shows no workspace without the role; do not fetch the intake.
    if (!context.workspace) return null;
    const result = await getEaccIntake({ data: { fy: deps.fy } });
    if (!result.intake.ok && result.intake.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    return result;
  },
  staticData: { crumb: m.intakeCrumb },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: IntakeLoading,
  component: IntakeLoaded,
});

function IntakeLoading() {
  return <IntakePageView result={null} />;
}

function IntakeLoaded() {
  const result = Route.useLoaderData();
  // The layout shows why there is no workspace.
  if (!result) return null;
  return <IntakePageView result={result} />;
}

function IntakePageView({ result }: { result: IntakePage | null }) {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/eacc/reports/' });
  return (
    <IntakeDashboard
      result={result}
      search={search}
      onSearchChange={(next) => {
        void navigate({ search: next, resetScroll: false });
      }}
      reportLink={(row, children) => (
        <Link to="/eacc/reports/$reportId" params={{ reportId: row.reportId ?? '' }}>
          {children}
        </Link>
      )}
    />
  );
}
