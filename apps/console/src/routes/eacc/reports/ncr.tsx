import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { messages as m } from '../../../components/national-report/messages';
import {
  defaultReportYear,
  ncrSearchSchema,
  reportYears,
} from '../../../components/national-report/model';
import { NationalReportView } from '../../../components/national-report/national-report-view';
import {
  type PatternCandidatesLoad,
  useNcrPatterns,
} from '../../../components/national-report/notable-patterns';
import { goToSignIn, signInRedirect } from '../../../components/sign-in-redirect';
import {
  approveNationalReportFn,
  buildNationalReportFn,
  getNationalReportPage,
  getNationalReportPdf,
  getPatternCandidatesFn,
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

const loadCandidates: PatternCandidatesLoad = (fy) => getPatternCandidatesFn({ data: { fy } });

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
  const fy = search.fy ?? defaultReportYear(now);
  const page = search.page ?? 1;
  const onPageChange = (next: number) => {
    void navigate({
      search: (previous) => ({ ...previous, page: next > 1 ? next : undefined }),
      resetScroll: false,
    });
  };
  const extensions = useNcrPatterns({
    fy,
    report: result?.ok ? result.data.report : null,
    load: loadCandidates,
    page,
    onPageChange,
    onUnauthenticated: goToSignIn,
  });
  return (
    <NationalReportView
      fy={fy}
      years={reportYears(now)}
      onYearChange={(fy) => {
        void navigate({ search: { fy } });
      }}
      page={page}
      onPageChange={onPageChange}
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
      extensions={extensions}
    />
  );
}
