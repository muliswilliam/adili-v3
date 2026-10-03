import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { ComplianceReportsTabs } from '../../../components/eacc-intake/reports-tabs';
import { messages as m } from '../../../components/national-report/messages';
import { NationalReportView } from '../../../components/national-report/national-report-view';
import {
  type NarrativeDraftAsk,
  type NationalReportLoad,
  useNcrNarrativeDrafting,
} from '../../../components/national-report/narrative-drafting';
import {
  type PatternCandidatesLoad,
  useNcrPatterns,
} from '../../../components/national-report/notable-patterns';
import { goToSignIn, signInRedirect } from '../../../components/sign-in-redirect';
import {
  approveNationalReportFn,
  buildNationalReportFn,
  draftNationalReportNarrativeFn,
  getNationalReportFn,
  getNationalReportPage,
  getNationalReportPdf,
  getPatternCandidatesFn,
  type NationalReportScreen,
  saveNationalReportNarrativeFn,
} from '../../../server/national-report';
import { financialYear } from '../../../server/form-m';

/** `?fy=` the year on show (else the last that ended); `page` the per-Commission table's page. */
const ncrSearchSchema = z.object({
  fy: financialYear.optional().catch(undefined),
  page: z.int().min(1).optional().catch(undefined),
});

/** EACC's national consolidated report for a financial year (spec 09 FE-4, #233). */
export const Route = createFileRoute('/eacc/reports/ncr')({
  validateSearch: ncrSearchSchema,
  // The table's page is applied in the browser; only another year reloads.
  loaderDeps: ({ search }) => ({ fy: search.fy }),
  loader: async ({ deps, context, location }): Promise<NationalReportScreen | null> => {
    // The layout shows why there is no workspace; do not fetch the report.
    if (!context.workspace) return null;
    const screen = await getNationalReportPage({ data: { fy: deps.fy } });
    if (!screen.page.ok && screen.page.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    return screen;
  },
  staticData: { crumb: m.title },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: NcrLoading,
  component: NcrLoaded,
});

const loadCandidates: PatternCandidatesLoad = (fy) => getPatternCandidatesFn({ data: { fy } });
const draftNarrative: NarrativeDraftAsk = (fy, request, idempotencyKey) =>
  draftNationalReportNarrativeFn({ data: { fy, ...request, idempotencyKey } });
const loadReport: NationalReportLoad = (fy) => getNationalReportFn({ data: { fy } });

function NcrLoading() {
  return <NcrPage screen={null} />;
}

function NcrLoaded() {
  const screen = Route.useLoaderData();
  // The layout shows why there is no workspace.
  if (!screen) return null;
  return <NcrPage screen={screen} />;
}

function NcrPage({ screen }: { screen: NationalReportScreen | null }) {
  const search = Route.useSearch();
  const { viewer, roles, subject } = Route.useRouteContext();
  const navigate = useNavigate({ from: '/eacc/reports/ncr' });
  const fy = screen?.fy ?? search.fy;
  const page = search.page ?? 1;
  const onPageChange = (next: number) => {
    void navigate({
      search: (previous) => ({ ...previous, page: next > 1 ? next : undefined }),
      resetScroll: false,
    });
  };
  const result = screen ? screen.page : null;
  const report = result?.ok ? result.data.report : null;
  const patterns = useNcrPatterns({
    fy: fy ?? 0,
    report,
    load: loadCandidates,
    page,
    onPageChange,
    onUnauthenticated: goToSignIn,
  });
  const drafting = useNcrNarrativeDrafting({
    fy: fy ?? 0,
    report,
    draft: draftNarrative,
    load: loadReport,
    onUnauthenticated: goToSignIn,
    // The figure chips follow the "Edited" label.
    figures: patterns.paragraphMeta,
  });
  const extensions = { ...patterns, ...drafting };
  return (
    <NationalReportView
      fy={fy ?? 0}
      today={screen?.today ?? null}
      tabs={<ComplianceReportsTabs current="ncr" fy={fy} />}
      onYearChange={(next) => {
        void navigate({ search: { fy: next } });
      }}
      page={page}
      onPageChange={onPageChange}
      result={result}
      viewer={{ subject: subject ?? '', name: viewer.user.name, roles }}
      build={(year) => buildNationalReportFn({ data: { fy: year } })}
      saveNarrative={(year, narrative) =>
        saveNationalReportNarrativeFn({ data: { fy: year, narrative } })
      }
      approve={(year, idempotencyKey) =>
        approveNationalReportFn({ data: { fy: year, idempotencyKey } })
      }
      pdfLink={(documentId) => getNationalReportPdf({ data: { documentId } })}
      onUnauthenticated={() => {
        goToSignIn();
      }}
      extensions={extensions}
    />
  );
}
