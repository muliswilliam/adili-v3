import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { messages as m } from '../../../components/national-report/messages';
import {
  defaultReportYear,
  ncrSearchSchema,
  reportYears,
} from '../../../components/national-report/model';
import { NationalReportView } from '../../../components/national-report/national-report-view';
import { goToSignIn, signInRedirect } from '../../../components/sign-in-redirect';
import {
  approveNationalReportFn,
  buildNationalReportFn,
  getNationalReportPage,
  getNationalReportPdf,
  saveNationalReportNarrativeFn,
} from '../../../server/national-report';
import type {
  NationalReportPage,
  NationalReportResult,
} from '../../../server/national-report.server';
import { BackToOverview } from './route';

/** EACC's national consolidated report for a financial year (spec 09 FE-4, #233). */
export const Route = createFileRoute('/eacc/reports/ncr')({
  validateSearch: ncrSearchSchema,
  // The table's page is applied in the browser; only another year reloads.
  loaderDeps: ({ search }) => ({ fy: search.fy ?? defaultReportYear(new Date()) }),
  loader: async ({ deps, context, location }) => {
    // The layout shows why there is no workspace; do not fetch the report.
    if (!context.workspace) return null;
    const result = await getNationalReportPage({ data: { fy: deps.fy } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  staticData: { crumb: m.title },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: NcrLoading,
  component: NcrLoaded,
});

function NcrLoading() {
  return <NcrPage result={null} />;
}

function NcrLoaded() {
  const result = Route.useLoaderData();
  if (!result) return null;
  return <NcrPage result={result} />;
}

function NcrPage({ result }: { result: NationalReportResult<NationalReportPage> | null }) {
  const search = Route.useSearch();
  const { viewer, roles, subject } = Route.useRouteContext();
  const navigate = useNavigate({ from: '/eacc/reports/ncr' });
  const now = new Date();
  return (
    <NationalReportView
      fy={search.fy ?? defaultReportYear(now)}
      years={reportYears(now)}
      onYearChange={(fy) => {
        void navigate({ search: { fy } });
      }}
      page={search.page ?? 1}
      onPageChange={(page) => {
        void navigate({
          search: (previous) => ({ ...previous, page: page > 1 ? page : undefined }),
          resetScroll: false,
        });
      }}
      result={result}
      viewer={{ subject: subject ?? '', name: viewer.user.name, roles }}
      build={(fy) => buildNationalReportFn({ data: { fy } })}
      saveNarrative={(fy, narrative) => saveNationalReportNarrativeFn({ data: { fy, narrative } })}
      approve={(fy, idempotencyKey) => approveNationalReportFn({ data: { fy, idempotencyKey } })}
      pdfLink={(documentId) => getNationalReportPdf({ data: { documentId } })}
      onUnauthenticated={() => {
        goToSignIn();
      }}
      forbiddenAction={<BackToOverview />}
    />
  );
}
