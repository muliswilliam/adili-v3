import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  cn,
  CopyButton,
  formatDate,
  formatDateTime,
  Icon,
  QrCode,
  ReleaseStatusBadge,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@adili/ui';
import {
  BanIcon,
  GlobeIcon,
  SecurityCheckIcon,
  SquareLock02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import type { OpenDataReleaseView, ReleasesResult } from '../../server/open-data-releases.server';
import type { PublicLinks } from '../../server/open-data-releases';
import type { OpenDataRelease } from '../../server/reporting/types';
import { OPEN_DATA_TABLES, type ReadTables } from '../../server/open-data-tables';
import { problemStatus } from '../../server/service-call';
import { formatNumber } from '../format';
import { LoadError, NoAccess } from '../load-error';
import { Page, PageHead } from '../page';
import { messages as m } from './messages';
import { ReleaseTable } from './release-tables';
import { KindTag } from './release-parts';

export interface ReleaseViewProps {
  /** The release with its tables; null while it loads. */
  result: ReleasesResult<OpenDataReleaseView> | null;
  links: PublicLinks;
  /** Publish, Withdraw and Build v{n+1} (#353), in the header. */
  actions?: (release: OpenDataReleaseView) => ReactNode;
  /**
   * Whether the viewer is an EACC supervisor: they have Publish, so a preview's "An EACC
   * supervisor publishes it" banner is for everyone else.
   */
  supervisor?: boolean;
}

/**
 * One open-data release as EACC sees it (spec 09b FE-3, S6, #350): a preview before a supervisor
 * publishes it, or a published or withdrawn release. Its status, version and who built or
 * published it; that a preview is not public, or why a release was withdrawn; the line saying its
 * totals reconcile with its source (S9); its six tables as built, suppression markers and legend
 * on each (S4); the manifest, every version of its year and kind (S7) and its files. States:
 * loading, not found, error, no access.
 */
export function ReleaseView({ result, links, actions, supervisor = false }: ReleaseViewProps) {
  if (result === null) return <ReleaseSkeleton />;
  if (!result.ok) {
    const status = problemStatus(result);
    return (
      <Page narrow>
        <PageHead title={m.release} />
        {status === 403 ? (
          <NoAccess text={m.noAccess} />
        ) : status === 404 || status === 400 ? (
          <NoAccess text={m.releaseNotFound} action={<BackToReleases />} />
        ) : (
          <LoadError
            title={m.releaseLoadErrorTitle}
            detail={m.loadErrorDetail}
            retryLabel={m.tryAgain}
          />
        )}
      </Page>
    );
  }
  const view = result.data;
  const { release } = view;
  return (
    <Page>
      <PageHead title={m.releaseTitle(release.fy, release.kind)} actions={actions?.(view)}>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ReleaseStatusBadge status={release.status} />
          <KindTag>{m.versionTag(release.version)}</KindTag>
          <span className="text-[13.5px] text-muted-foreground">{headMeta(view)}</span>
        </div>
      </PageHead>
      <Banner view={view} supervisor={supervisor} />
      <ReconciliationLine view={view} />
      <div className="grid items-start gap-4 min-[1180px]:grid-cols-[minmax(0,1fr)_320px]">
        <TablesCard tables={view.tables} />
        <div className="grid gap-4">
          <ManifestCard view={view} verifyBase={links.verifyBase} />
          <VersionsCard view={view} />
          <FilesCard view={view} />
        </div>
      </div>
    </Page>
  );
}

function BackToReleases() {
  return (
    <Button asChild variant="secondary" size="sm">
      <Link to="/eacc/open-data">{m.backToReleases}</Link>
    </Button>
  );
}

/** As at: a snapshot's build day; an annual release's financial year end. */
function asAtOf(view: OpenDataReleaseView): string {
  const { release } = view;
  return release.kind === 'annual' ? `${String(release.fy + 1)}-06-30` : release.builtAt;
}

function headMeta(view: OpenDataReleaseView): string {
  const { release, builtBy } = view;
  const when =
    release.publishedAt && release.status !== 'preview'
      ? publishedOnApproval(view)
        ? m.publishedOnApproval(formatDateTime(release.publishedAt))
        : m.publishedOn(formatDateTime(release.publishedAt), release.publishedBy?.name ?? null)
      : m.builtBy(formatDateTime(release.builtAt), builtBy?.name ?? null);
  return `${when} · ${m.asAt(formatDate(asAtOf(view)))}`;
}

/** The release workflow builds the annual release on NCR approval: nobody built it by hand. */
function publishedOnApproval(view: OpenDataReleaseView): boolean {
  return view.release.kind === 'annual' && view.builtBy === null;
}

function Banner({ view, supervisor }: { view: OpenDataReleaseView; supervisor: boolean }) {
  const { release } = view;
  if (release.status === 'withdrawn') {
    const next = view.versions?.find((each) => each.version === release.version + 1);
    return (
      <Alert variant="destructive" className="mb-3.5">
        <Icon icon={BanIcon} />
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <AlertDescription className="min-w-0 flex-[1_1_240px]">
            <b>
              {m.withdrawnBanner(
                formatDate(release.withdrawnAt ?? release.builtAt),
                release.withdrawnBy?.name ?? null,
              )}
            </b>{' '}
            “{release.withdrawnReason}”
          </AlertDescription>
          {next ? (
            <Button asChild variant="secondary" size="sm" className="self-center">
              <Link to="/eacc/open-data/$releaseId" params={{ releaseId: next.id }}>
                {m.openVersion(next.version)}
              </Link>
            </Button>
          ) : null}
        </div>
      </Alert>
    );
  }
  if (release.status === 'preview' && !supervisor) {
    return (
      <Alert role="status" className="mb-3.5">
        <Icon icon={SquareLock02Icon} />
        <AlertDescription>{m.notPublic}</AlertDescription>
      </Alert>
    );
  }
  return null;
}

/** S9: the release reconciled with its source when it was built, or it would not exist. */
function ReconciliationLine({ view }: { view: OpenDataReleaseView }) {
  const { source, tables } = view;
  const reference = source.nationalReportReference;
  const label: ReactNode = reference ? (
    <span className="font-mono text-[13px]">{reference}</span>
  ) : source.kind === 'live-projections' ? (
    m.sourceLive
  ) : (
    m.sourceNcrDraft
  );
  const national = (measure: string) =>
    tables['national-totals'].rows.find((row) => row.measure === measure)?.value ?? null;
  const filed = national('filed');
  const expected = national('expected');
  return (
    <p className="mb-4 flex items-start gap-2 text-[13.5px] text-secondary-foreground">
      <Icon icon={Tick02Icon} className="mt-0.5 size-[15px] shrink-0 text-success" />
      <span>
        {m.totalsMatch} {label}
        {filed !== null && expected !== null
          ? m.reconciledCounts(formatNumber(filed), formatNumber(expected))
          : '.'}
      </span>
    </p>
  );
}

function TablesCard({ tables }: { tables: ReadTables }) {
  return (
    <Card className="min-w-0 overflow-hidden p-0 sm:p-0">
      <Tabs defaultValue={OPEN_DATA_TABLES[0]}>
        <TabsList aria-label={m.tablesLabel} className="px-3">
          {OPEN_DATA_TABLES.map((key) => (
            <TabsTrigger key={key} value={key}>
              {m.tables[key]}
            </TabsTrigger>
          ))}
        </TabsList>
        {OPEN_DATA_TABLES.map((key) => (
          <TabsContent key={key} value={key} className="mt-0 rounded-none">
            <ReleaseTable tables={tables} table={key} />
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}

function SideCard({
  id,
  title,
  actions,
  children,
}: {
  id: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card role="region" aria-labelledby={id} className="min-w-0 overflow-hidden p-0 sm:p-0">
      <div className="flex items-center gap-2 border-b px-4 py-3.5">
        <h2 id={id} className="text-[15.5px] font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </Card>
  );
}

function ManifestCard({
  view,
  verifyBase,
}: {
  view: OpenDataReleaseView;
  verifyBase: string | null;
}) {
  const code = view.release.manifestVerificationId;
  if (!code) {
    return (
      <SideCard id="release-manifest" title={m.manifest}>
        <p className="px-4 py-3.5 text-[13.5px] text-muted-foreground">{m.manifestPending}</p>
      </SideCard>
    );
  }
  const verifyUrl = verifyBase ? `${verifyBase}/v/${code}` : null;
  return (
    <SideCard
      id="release-manifest"
      title={m.manifest}
      actions={
        <Badge>
          <Icon icon={GlobeIcon} className="size-3" />
          {m.manifestPublic}
        </Badge>
      }
    >
      <div className="flex items-center gap-3.5 px-4 py-3.5">
        {verifyUrl ? (
          <div className="shrink-0 rounded-lg p-1 leading-none shadow-card-flat">
            <QrCode value={verifyUrl} label={m.manifestQr(code)} size={64} />
          </div>
        ) : null}
        <div className="grid min-w-0 gap-2">
          <span className="font-mono text-[12.5px] leading-[1.45] break-all">{code}</span>
          <div className="flex flex-wrap gap-2">
            {verifyUrl ? (
              <Button asChild variant="secondary" size="xs">
                <a href={verifyUrl} target="_blank" rel="noopener noreferrer">
                  <Icon icon={SecurityCheckIcon} />
                  {m.verify}
                </a>
              </Button>
            ) : null}
            <CopyButton value={code} label={m.copy} showLabel size="xs" copiedMessage={m.copied} />
          </div>
        </div>
      </div>
    </SideCard>
  );
}

/**
 * S7: every version of the release's year and kind, the latest first: its status, the reason a
 * withdrawn one gives, and when it was withdrawn, published and built. The others link to theirs.
 */
function VersionsCard({ view }: { view: OpenDataReleaseView }) {
  const { release, versions } = view;
  return (
    <SideCard id="release-versions" title={m.versions}>
      {versions === null ? (
        <p className="px-4 py-3.5 text-[13.5px] text-muted-foreground">{m.versionsUnavailable}</p>
      ) : (
        <ol className="py-1">
          {versions.map((each) => {
            const current = each.id === release.id;
            const label = m.version(each.version);
            return (
              <li
                key={each.id}
                aria-label={label}
                aria-current={current ? 'page' : undefined}
                className={cn('px-4 py-3 [&+&]:border-t', current && 'bg-muted/50')}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {current ? (
                    <b className="text-[14px]">{label}</b>
                  ) : (
                    <Link
                      to="/eacc/open-data/$releaseId"
                      params={{ releaseId: each.id }}
                      className="rounded-sm text-[14px] font-bold text-foreground hover:underline"
                    >
                      {label}
                    </Link>
                  )}
                  <ReleaseStatusBadge status={each.status} />
                  {current ? (
                    <span className="text-[12.5px] text-muted-foreground">{m.viewing}</span>
                  ) : null}
                </div>
                {each.withdrawnReason ? (
                  <blockquote className="mt-2 rounded-r-md border-l-2 border-destructive bg-destructive-subtle px-2.5 py-1.5 text-[13px] text-secondary-foreground">
                    {each.withdrawnReason}
                  </blockquote>
                ) : null}
                <ul className="mt-2 grid gap-0.5 text-[12.5px] text-muted-foreground">
                  {versionEvents(each, current ? view : null).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </SideCard>
  );
}

/** What happened to a version, the latest first; who built it is known for the one on show. */
function versionEvents(each: OpenDataRelease, shown: OpenDataReleaseView | null): string[] {
  const lines: string[] = [];
  if (each.withdrawnAt) {
    lines.push(m.eventWithdrawn(formatDateTime(each.withdrawnAt), each.withdrawnBy?.name ?? null));
  }
  if (each.publishedAt) {
    lines.push(
      shown && publishedOnApproval(shown)
        ? m.publishedOnApproval(formatDateTime(each.publishedAt))
        : m.publishedOn(formatDateTime(each.publishedAt), each.publishedBy?.name ?? null),
    );
  }
  lines.push(m.eventBuilt(formatDateTime(each.builtAt), shown?.builtBy?.name ?? null));
  return lines;
}

/** The release's table files with their rows, hidden figures and SHA-256 (in the manifest). */
function FilesCard({ view }: { view: OpenDataReleaseView }) {
  return (
    <SideCard id="release-files" title={m.files}>
      <ul className="divide-y py-1">
        {view.release.tables.map((file) => {
          const hidden = view.tables[file.table].suppression.cellsSuppressed;
          return (
            <li key={file.table} className="px-4 py-2 text-[13.5px]">
              <div className="truncate font-medium">{file.table}</div>
              <div className="text-[12.5px] text-muted-foreground">
                {m.fileRows(file.rows)}
                {hidden > 0 ? ` · ${m.fileHidden(hidden)}` : ''}
              </div>
              <div
                className="truncate font-mono text-[11.5px] text-muted-foreground"
                title={m.fileHash(file.sha256Json)}
              >
                {m.fileHash(file.sha256Json)}
              </div>
            </li>
          );
        })}
      </ul>
    </SideCard>
  );
}

function ReleaseSkeleton() {
  return (
    <Page aria-busy="true">
      <Skeleton className="mb-3 h-8 w-[320px] rounded-lg" />
      <Skeleton className="mb-6 h-5 w-[440px] rounded-lg" />
      <div className="grid items-start gap-4 min-[1180px]:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-[520px] w-full rounded-2xl" />
        <div className="grid gap-4">
          <Skeleton className="h-[120px] w-full rounded-2xl" />
          <Skeleton className="h-[320px] w-full rounded-2xl" />
        </div>
      </div>
    </Page>
  );
}
