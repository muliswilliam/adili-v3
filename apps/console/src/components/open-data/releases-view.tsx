import {
  Alert,
  Button,
  Card,
  cn,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  focusRingInset,
  formatDate,
  formatDateTime,
  Icon,
  IconTile,
  ReleaseStatusBadge,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  ChartColumnIcon,
  LinkSquare02Icon,
  PlusSignIcon,
  RefreshIcon,
  SquareLock02Icon,
  WifiDisconnected01Icon,
} from '@hugeicons/core-free-icons';
import { Link, useRouter } from '@tanstack/react-router';
import { useState } from 'react';

import type { ReleasesResult } from '../../server/open-data-releases.server';
import type { PublicLinks } from '../../server/open-data-releases';
import type { OpenDataRelease } from '../../server/reporting/types';
import { problemStatus } from '../../server/service-call';
import { CursorPager } from '../cursor-pager';
import { NoAccess } from '../load-error';
import { Page, PageHead } from '../page';
import { messages as m } from './messages';
import { buildFailure, mayBeRecorded } from './problems';
import { KindTag, releaseName } from './release-parts';

/** Releases per page, as the prototype pages them. */
const PER_PAGE = 10;

export interface ReleasesViewProps {
  /** The releases; null while they load. */
  result: ReleasesResult<OpenDataRelease[]> | null;
  links: PublicLinks;
  /** The year a snapshot is built for: the current financial year. */
  fy: number;
  build: (fy: number, idempotencyKey: string) => Promise<ReleasesResult<OpenDataRelease>>;
  /** Opens the preview just built. */
  onBuilt: (release: OpenDataRelease) => void;
  onUnauthenticated: () => void;
}

type BuildState =
  | { kind: 'idle' }
  | { kind: 'confirming'; key: string }
  | { kind: 'building'; key: string }
  | { kind: 'failed'; key: string; message: string };

/**
 * EACC's open-data releases (spec 09b FE-3, #350): every release with its year, kind, version,
 * status and publication, and Build snapshot (analyst and supervisor), which builds the current
 * year's snapshot as a preview and opens it. States: loading, empty, error, no access, building,
 * build stopped (reconciliation or another refusal).
 */
export function ReleasesView(props: ReleasesViewProps) {
  const { result, links } = props;
  const [build, setBuild] = useState<BuildState>({ kind: 'idle' });
  // The key of a build that may have been recorded (no answer, or still running): every build
  // started until it is settled reuses it, so the service replays it instead of building again.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  if (problemStatus(result) === 403) {
    return (
      <Page narrow>
        <PageHead title={m.title} />
        <NoAccess text={m.noAccess} action={<BackToOverview />} />
      </Page>
    );
  }
  const building = build.kind === 'building';
  const startBuild = () => {
    setBuild({ kind: 'confirming', key: pendingKey ?? crypto.randomUUID() });
  };
  const runBuild = async (key: string) => {
    setBuild({ kind: 'building', key });
    const built = await props.build(props.fy, key);
    if (built.ok) {
      setPendingKey(null);
      setBuild({ kind: 'idle' });
      props.onBuilt(built.data);
      return;
    }
    if (built.error.kind === 'unauthenticated') {
      props.onUnauthenticated();
      return;
    }
    // A refusal (4xx) wrote nothing, so a retry is a new build. A build that got no answer may
    // have been recorded, and one still running (`idempotency-key-in-use`) will be: the retry, or
    // the next Build snapshot, keeps its key and so replays it.
    const retryKey = mayBeRecorded(built) ? key : crypto.randomUUID();
    setPendingKey(mayBeRecorded(built) ? key : null);
    setBuild({ kind: 'failed', key: retryKey, message: buildFailure(built) });
  };
  return (
    <Page>
      <PageHead
        title={m.title}
        actions={
          <>
            {links.publicPage ? (
              <Button asChild variant="secondary">
                <a href={links.publicPage} target="_blank" rel="noopener noreferrer">
                  <Icon icon={LinkSquare02Icon} />
                  {m.publicPage}
                </a>
              </Button>
            ) : null}
            <Button disabled={building} onClick={startBuild}>
              <Icon icon={PlusSignIcon} />
              {m.buildSnapshot}
            </Button>
          </>
        }
      />
      {build.kind === 'building' ? <BuildingCard fy={props.fy} /> : null}
      {build.kind === 'failed' ? (
        <BuildStopped
          message={build.message}
          busy={false}
          onRetry={() => void runBuild(build.key)}
          onDismiss={() => {
            setBuild({ kind: 'idle' });
          }}
        />
      ) : null}
      {result === null ? (
        <LoadingTable />
      ) : !result.ok ? (
        <ListError />
      ) : result.data.length === 0 ? (
        <Card className="p-0 sm:p-0">
          <EmptyState
            icon={<Icon icon={ChartColumnIcon} />}
            title={m.emptyTitle}
            description={m.emptyText}
            action={
              <Button variant="secondary" disabled={building} onClick={startBuild}>
                <Icon icon={PlusSignIcon} />
                {m.buildSnapshot}
              </Button>
            }
          />
        </Card>
      ) : (
        <ReleasesTable releases={result.data} />
      )}
      <BuildDialog
        fy={props.fy}
        open={build.kind === 'confirming'}
        onOpenChange={(open) => {
          if (!open) setBuild({ kind: 'idle' });
        }}
        onBuild={() => {
          if (build.kind === 'confirming') void runBuild(build.key);
        }}
      />
    </Page>
  );
}

function BackToOverview() {
  return (
    <Button asChild variant="secondary" size="sm">
      <Link to="/">{m.backToOverview}</Link>
    </Button>
  );
}

function ReleasesTable({ releases }: { releases: OpenDataRelease[] }) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(releases.length / PER_PAGE));
  const current = Math.min(page, pages);
  const from = (current - 1) * PER_PAGE;
  const shown = releases.slice(from, from + PER_PAGE);
  return (
    <Card className="overflow-hidden p-0 sm:p-0">
      {/* Phones get a list of the same releases; the table needs the width. */}
      <ul className="divide-y min-[700px]:hidden">
        {shown.map((release) => (
          <li key={release.id}>
            <Link
              to="/eacc/open-data/$releaseId"
              params={{ releaseId: release.id }}
              aria-label={m.openRelease(releaseName(release))}
              className={cn('flex items-center gap-2.5 px-4 py-3.5', focusRingInset)}
            >
              <div className="grid min-w-0 flex-1 gap-1.5">
                <div className="flex flex-wrap items-center gap-2 font-semibold">
                  {m.year(release.fy)}
                  <KindTag>{m.kind[release.kind]}</KindTag>
                  <span className="text-[13px] font-medium text-muted-foreground">
                    {m.version(release.version)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                  <ReleaseStatusBadge status={release.status} />
                  <PublicationLine release={release} />
                </div>
              </div>
              <Icon icon={ArrowRight01Icon} className="size-[17px] text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden min-[700px]:block">
        <Table caption={m.listCaption}>
          <TableHeader>
            <TableRow>
              <TableHead>{m.columnYear}</TableHead>
              <TableHead>{m.columnKind}</TableHead>
              <TableHead className="text-right">{m.columnVersion}</TableHead>
              <TableHead>{m.columnStatus}</TableHead>
              <TableHead>{m.columnPublished}</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">{m.release}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((release) => (
              <TableRow key={release.id} className="relative hover:bg-muted/40">
                <TableHead scope="row" className="py-4 text-[14.5px] font-semibold text-foreground">
                  <TableRowLink asChild>
                    <Link
                      to="/eacc/open-data/$releaseId"
                      params={{ releaseId: release.id }}
                      aria-label={m.openRelease(releaseName(release))}
                    >
                      {m.year(release.fy)}
                    </Link>
                  </TableRowLink>
                </TableHead>
                <TableCell>
                  <KindTag>{m.kind[release.kind]}</KindTag>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.version(release.version)}
                </TableCell>
                <TableCell>
                  <ReleaseStatusBadge status={release.status} />
                </TableCell>
                <TableCell>
                  <Publication release={release} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <Icon icon={ArrowRight01Icon} className="size-[17px]" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <CursorPager
        labels={{
          pagination: m.pagination,
          pageRange: (start, end) => m.pageRange(start, end, releases.length),
          pageRows: m.pageRows,
          previousPage: m.previousPage,
          nextPage: m.nextPage,
        }}
        range={{ from: from + 1, to: from + shown.length }}
        rows={shown.length}
        hasPrevious={current > 1}
        hasNext={current < pages}
        onPrevious={() => {
          setPage(current - 1);
        }}
        onNext={() => {
          setPage(current + 1);
        }}
      />
    </Card>
  );
}

/** The phone list's line: when it was published, then who or since when it is withdrawn. */
function PublicationLine({ release }: { release: OpenDataRelease }) {
  const { main, sub } = publicationOf(release);
  return <span>{[release.publishedAt ? main : null, sub].filter(Boolean).join(' · ')}</span>;
}

function publicationOf(release: OpenDataRelease): { main: string; sub: string | null } {
  const main = release.publishedAt ? formatDateTime(release.publishedAt) : m.notPublished;
  const sub =
    release.status === 'withdrawn' && release.withdrawnAt
      ? m.withdrawnOn(formatDate(release.withdrawnAt))
      : release.status === 'preview'
        ? m.builtOn(formatDateTime(release.builtAt))
        : (release.publishedBy?.name ?? null);
  return { main, sub };
}

/** When and by whom it was published; a preview is not, a withdrawn one says when. */
function Publication({ release }: { release: OpenDataRelease }) {
  const { main, sub } = publicationOf(release);
  return (
    <div className="min-w-0">
      <div className="text-[14px] text-foreground">{main}</div>
      {sub ? <div className="mt-0.5 text-[13px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function LoadingTable() {
  return (
    <Card className="overflow-hidden p-0 sm:p-0">
      <Table caption={m.listCaption} aria-busy="true">
        <TableHeader>
          <TableRow>
            <TableHead>{m.columnYear}</TableHead>
            <TableHead>{m.columnKind}</TableHead>
            <TableHead>{m.columnVersion}</TableHead>
            <TableHead>{m.columnStatus}</TableHead>
            <TableHead>{m.columnPublished}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[0, 1, 2, 3].map((row) => (
            <TableRow key={row}>
              {['w-[70%]', 'w-[60%]', 'w-[50%]', 'w-[55%]', 'w-[45%]'].map((width) => (
                <TableCell key={width}>
                  <Skeleton className={`h-2.5 ${width} rounded-full`} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function ListError() {
  const router = useRouter();
  return (
    <Card className="p-0 sm:p-0">
      <EmptyState
        tone="destructive"
        icon={<Icon icon={WifiDisconnected01Icon} />}
        title={m.loadErrorTitle}
        description={m.loadErrorDetail}
        className="py-12"
        action={
          <Button variant="secondary" onClick={() => void router.invalidate()}>
            <Icon icon={RefreshIcon} />
            {m.tryAgain}
          </Button>
        }
      />
    </Card>
  );
}

/** The build in progress: one request, so its steps are listed, not ticked off. */
function BuildingCard({ fy }: { fy: number }) {
  return (
    <Card
      role="status"
      aria-live="polite"
      className="mb-3.5 flex-row items-start gap-3.5 px-5 py-4"
    >
      <Spinner className="mt-0.5 size-[22px]" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{m.building(fy)}</div>
        <ul className="mt-2.5 flex flex-wrap gap-x-[18px] gap-y-1.5 text-[13px] text-muted-foreground">
          {m.buildSteps.map((step, index) => (
            <li key={step} className="inline-flex items-center gap-1.5">
              <span className="grid size-[18px] place-items-center rounded-full bg-muted text-[11px] text-secondary-foreground">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function BuildStopped({
  message,
  busy,
  onRetry,
  onDismiss,
}: {
  message: string;
  busy: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <Alert
      variant="destructive"
      className="mb-3.5 flex flex-wrap items-start gap-x-3 gap-y-2 [&>svg]:static [&>svg~*]:pl-0"
    >
      <Icon icon={AlertCircleIcon} className="mt-0.5" />
      <p className="min-w-0 flex-[1_1_240px]">
        <b>{m.buildStopped}</b> {message}
      </p>
      <div className="ml-[30px] flex flex-none gap-2 self-center sm:ml-0">
        <Button variant="secondary" size="sm" disabled={busy} onClick={onRetry}>
          {m.tryAgain}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {m.dismiss}
        </Button>
      </div>
    </Alert>
  );
}

function BuildDialog({
  fy,
  open,
  onOpenChange,
  onBuild,
}: {
  fy: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBuild: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader className="flex-row items-center gap-3 pr-12">
          <IconTile>
            <Icon icon={ChartColumnIcon} />
          </IconTile>
          <DialogTitle>{m.buildTitle(fy)}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <p className="text-[14.5px] leading-[1.55]">{m.buildText}</p>
          <p className="flex items-center gap-2.5 text-[14px] text-secondary-foreground">
            <Icon icon={SquareLock02Icon} className="size-4 text-muted-foreground" />
            {m.buildPreviewOnly}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {m.cancel}
          </Button>
          <Button type="button" onClick={onBuild}>
            <Icon icon={PlusSignIcon} />
            {m.build}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
