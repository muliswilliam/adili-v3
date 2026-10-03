import { Icon } from '@adili/ui';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link } from '@tanstack/react-router';

import { downloadFrom } from '../../../components/download';
import { messages as m } from '../../../components/eacc-intake/messages';
import { ReportViewer } from '../../../components/eacc-intake/report-viewer';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { getReportFileLink, getSubmittedReport } from '../../../server/eacc-intake';
import type { EaccResult, ReportView } from '../../../server/eacc-intake.server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_FOUND = {
  ok: false,
  error: { kind: 'problem', problem: { type: 'about:blank', title: 'Not found', status: 404 } },
} as const satisfies EaccResult<never>;

/** The crumb and title: the Commission whose report it is, once known. */
function crumbOf(loaderData: unknown): string {
  if (typeof loaderData !== 'object' || loaderData === null || !('ok' in loaderData)) {
    return m.title;
  }
  const result = loaderData as EaccResult<ReportView>;
  return result.ok ? result.data.report.commission.name : m.reportNotFoundTitle;
}

/** A Commission's Form M as filed (spec 09 FE-3): EACC's report viewer. */
export const Route = createFileRoute('/eacc/reports/$reportId')({
  loader: async ({ params, context, location }): Promise<EaccResult<ReportView> | null> => {
    if (!context.workspace) return null;
    if (!UUID.test(params.reportId)) return NOT_FOUND;
    const result = await getSubmittedReport({ data: { reportId: params.reportId } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  staticData: { crumb: ({ loaderData }) => crumbOf(loaderData) },
  head: ({ loaderData }) => ({
    meta: [{ title: `${crumbOf(loaderData)} · Adili Online Console` }],
  }),
  pendingComponent: () => <ReportPage result={null} />,
  component: ReportLoaded,
});

function ReportLoaded() {
  const result = Route.useLoaderData();
  if (!result) return null;
  return <ReportPage result={result} />;
}

async function download(documentId: string): Promise<boolean> {
  const link = await getReportFileLink({ data: { documentId } });
  if (!link.ok) return false;
  downloadFrom(link.data.downloadUrl);
  return true;
}

function ReportPage({ result }: { result: EaccResult<ReportView> | null }) {
  const fy = result?.ok ? result.data.report.fy : undefined;
  return (
    <ReportViewer
      result={result}
      onDownload={download}
      backLink={
        <Link
          to="/eacc/reports"
          search={fy === undefined ? {} : { fy }}
          className="inline-flex items-center gap-1 rounded-sm hover:text-foreground"
        >
          <Icon icon={ArrowLeft01Icon} className="size-3.5" />
          {m.allReports}
        </Link>
      }
    />
  );
}
