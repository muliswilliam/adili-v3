import { EACC_ROLES } from '@adili/roles';
import {
  Button,
  Card,
  EmptyState,
  formatDate,
  formatNumber,
  Icon,
  ReleaseStatusBadge,
  Skeleton,
  SuppressionLegend,
  SuppressionMarker,
  type UnshownFigureKind,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@adili/ui';
import { ChartColumnIcon, LinkSquare01Icon } from '@hugeicons/core-free-icons';
import { type ReactNode, useId } from 'react';

import { LoadError, NoAccess } from '../load-error';
import type { OpenDataPreviewLoad } from '../../server/open-data-preview';
import { ACCESS_REQUEST_FIGURES, COMPLIANCE_FIGURES } from '../../server/open-data-figures';
import type {
  CommissionOpenDataPreview,
  FilingRow,
  OpenDataRelease,
} from '../../server/open-data-preview.server';
import { messages as m } from './messages';

/**
 * The Commission open-data preview's body (spec 09b FE-3, S6): which release the figures come
 * from, the suppression legend, and the Commission's own rows of the three Commission tables, as
 * released. `load` null while loading. The page title and role gating are the route's.
 */
export function OpenDataPreview({ load }: { load: OpenDataPreviewLoad | null }) {
  if (!load) return <PreviewSkeleton />;
  const { preview } = load;
  if (!preview.ok) {
    const { error } = preview;
    // The page asks only for the viewer's own Commission, as its commission-admin (others are
    // turned away before): 404 there is "no release built yet", 403 a role it no longer holds.
    if (error.kind === 'problem' && error.problem.status === 404) return <NoOpenData />;
    if (error.kind === 'problem' && error.problem.status === 403) {
      return <NoAccess text={m.forStaff} />;
    }
    return <LoadError title={m.errorTitle} detail={m.errorDetail} retryLabel={m.tryAgain} />;
  }
  return <Preview data={preview.data} publicPageUrl={load.publicPageUrl} />;
}

/** Why the page is not for a viewer without the workspace: EACC has its own Open data. */
export function noAccessText(roles: readonly string[]): string {
  return EACC_ROLES.some((role) => roles.includes(role)) ? m.forEacc : m.forStaff;
}

function Preview({
  data,
  publicPageUrl,
}: {
  data: CommissionOpenDataPreview;
  publicPageUrl: string | null;
}) {
  const filing = shownFilingRows(data.filing);
  const { compliance, accessRequests } = data;
  const markers = [
    ...filing.flatMap((row) =>
      FILING_FIGURES.map((figure) => unshown(row, figure, filingGap(row))),
    ),
    ...(compliance
      ? COMPLIANCE_FIGURES.map((figure) => unshown(compliance, figure, 'not-reported'))
      : []),
    ...(accessRequests
      ? ACCESS_REQUEST_FIGURES.map((figure) => unshown(accessRequests, figure, 'not-collected'))
      : []),
  ];
  const cellsSuppressed = markers.filter((kind) => kind === 'suppressed').length;
  const keys = LEGEND_KEYS.filter((kind) => markers.includes(kind));
  return (
    <>
      <ReleaseSource release={data.release} publicPageUrl={publicPageUrl} />
      <Card className="mb-3.5 px-4 py-3 sm:px-4 sm:py-3">
        <SuppressionLegend cellsSuppressed={cellsSuppressed || undefined} keys={keys} />
      </Card>
      <div className="grid gap-4">
        <Section title={m.declarations}>
          <DeclarationsTable rows={filing} />
        </Section>
        <div className="grid items-start gap-4 min-[900px]:grid-cols-2">
          <Section title={m.compliance}>
            {data.compliance ? (
              <FigureList
                caption={m.compliance}
                row={data.compliance}
                figures={COMPLIANCE_FIGURES}
                labels={m.complianceFigures}
                gap="not-reported"
              />
            ) : (
              <NoRow />
            )}
          </Section>
          <Section title={m.accessRequests}>
            {data.accessRequests ? (
              <FigureList
                caption={m.accessRequests}
                row={data.accessRequests}
                figures={ACCESS_REQUEST_FIGURES}
                labels={m.accessRequestFigures}
                gap="not-collected"
              />
            ) : (
              <NoRow />
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

/** "Published · From FY 2025/2026 annual v1 · Published 18 Sep 2026", and the public page. */
function ReleaseSource({
  release,
  publicPageUrl,
}: {
  release: OpenDataRelease;
  publicPageUrl: string | null;
}) {
  const publishedAt = release.status === 'published' ? release.publishedAt : null;
  return (
    <div className="-mt-2 mb-3.5 flex flex-wrap items-center gap-2.5 text-sm text-secondary-foreground">
      <ReleaseStatusBadge status={release.status} />
      <p>
        {m.from} <b className="font-semibold text-foreground">{releaseName(release)}</b>
        {' · '}
        {publishedAt ? (
          m.published(formatDate(publishedAt))
        ) : (
          <>
            {m.built(formatDate(release.builtAt))}
            {' · '}
            {m.notPublicYet}
          </>
        )}
      </p>
      {publishedAt && publicPageUrl ? (
        <Button asChild variant="ghost" size="sm" className="ml-auto">
          <a href={publicPageUrl} target="_blank" rel="noopener noreferrer">
            <Icon icon={LinkSquare01Icon} />
            {m.publicPage}
            <span className="sr-only"> ({m.publicPageHint})</span>
          </a>
        </Button>
      ) : null}
    </div>
  );
}

function releaseName(release: OpenDataRelease): string {
  return m.releaseName(release.fy, release.kind, release.version);
}

/** A card with a hairline header and the title (the prototype's `.sec-h`), labelled by it. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <Card role="region" aria-labelledby={id} className="min-w-0 gap-0 p-0 sm:p-0">
      <div className="border-b px-5 py-4">
        <h2 id={id} className="text-[15.5px] font-semibold tracking-[-0.01em]">
          {title}
        </h2>
      </div>
      {children}
    </Card>
  );
}

const CYCLE_ORDER: readonly FilingRow['cycle'][] = ['initial', 'biennial', 'final', 'all'];

/**
 * The cycles to list, in order, the total last. A cycle nothing was expected of (the biennial in
 * an even year) is left out; a Commission that has not reported keeps every row.
 */
export function shownFilingRows(rows: readonly FilingRow[]): FilingRow[] {
  return CYCLE_ORDER.flatMap((cycle) =>
    rows.filter((row) => row.cycle === cycle && (cycle === 'all' || row.expected !== 0)),
  );
}

const FILING_FIGURES = ['expected', 'filed', 'nonFilers', 'filingRate'] as const;

/**
 * Why a figure is shown blank: one of the markers, or `nothing` for a figure over nobody (a
 * filing rate with no officers expected).
 */
type Unshown = UnshownFigureKind | 'nothing';

/** What a filing row's null figures are, unsuppressed: not reported, or over nobody expected. */
function filingGap(row: FilingRow): Unshown {
  return row.reportStatus === 'not-reported' ? 'not-reported' : 'nothing';
}

function DeclarationsTable({ rows }: { rows: FilingRow[] }) {
  return (
    <Table caption={m.declarationsCaption}>
      <TableHeader>
        <TableRow>
          <TableHead>{m.cycle}</TableHead>
          <TableHead className="text-right">{m.expected}</TableHead>
          <TableHead className="text-right">{m.declared}</TableHead>
          <TableHead className="text-right">{m.didNotDeclare}</TableHead>
          <TableHead className="text-right">{m.rate}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.cycle}>
            <TableHead scope="row" className="py-2.5 font-medium">
              {m.cycles[row.cycle]}
            </TableHead>
            {FILING_FIGURES.map((figure) => (
              <TableCell key={figure} className="py-2.5 text-right tabular-nums">
                <Figure
                  value={row[figure]}
                  marker={unshown(row, figure, filingGap(row))}
                  format={figure === 'filingRate' ? formatRate : formatNumber}
                />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Why a row's figure is not shown, or null when it is: suppressed (the whole row is), else `gap`
 * for a figure null unsuppressed (compliance: the Commission has not reported; access requests:
 * not collected yet, spec 10).
 */
function unshown<Row extends { suppressed: boolean }>(
  row: Row,
  figure: keyof Row,
  gap: Unshown,
): Unshown | null {
  if (row[figure] !== null) return null;
  return row.suppressed ? 'suppressed' : gap;
}

/** One Commission row as a list of figures, label beside value (the prototype's transposed table). */
function FigureList<Figure extends string>({
  caption,
  row,
  figures,
  labels,
  gap,
}: {
  caption: string;
  row: Record<Figure, number | null> & { suppressed: boolean };
  figures: readonly Figure[];
  labels: Record<Figure, string>;
  gap: UnshownFigureKind;
}) {
  return (
    <Table caption={caption}>
      <TableBody>
        {figures.map((figure) => (
          <TableRow key={figure}>
            <TableHead scope="row" className="py-2.5 font-medium">
              {labels[figure]}
            </TableHead>
            <TableCell className="py-2.5 text-right tabular-nums">
              <Figure
                value={row[figure]}
                marker={unshown(row, figure, gap)}
                format={formatNumber}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Figure({
  value,
  marker,
  format,
}: {
  value: number | null;
  marker: Unshown | null;
  format: (value: number) => string;
}) {
  if (value !== null) return <>{format(value)}</>;
  if (marker === 'nothing' || marker === null) {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">{m.nothingExpected}</span>
        <span className="sr-only">{m.nothingExpectedText}</span>
      </span>
    );
  }
  return <SuppressionMarker kind={marker} className="align-middle" />;
}

const RATE_FORMAT = new Intl.NumberFormat('en-KE', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * A release's filing rate (filed / expected, to four decimals) as a percentage with one decimal,
 * `96.2%`, `91.0%`, so the column lines up.
 */
function formatRate(rate: number): string {
  return RATE_FORMAT.format(rate);
}

/** The legend explains the kinds of marker on show, in this order. */
const LEGEND_KEYS: readonly UnshownFigureKind[] = ['suppressed', 'not-reported', 'not-collected'];

function NoRow() {
  return <p className="px-5 py-4 text-sm text-muted-foreground">{m.noRow}</p>;
}

function NoOpenData() {
  return (
    <Card className="p-2 sm:p-2">
      <EmptyState
        icon={<Icon icon={ChartColumnIcon} />}
        title={m.emptyTitle}
        description={m.emptyText}
      />
    </Card>
  );
}

function PreviewSkeleton() {
  return (
    <Card role="status" aria-busy="true" aria-label={m.title} className="gap-3.5">
      <Skeleton className="w-2/5" />
      <Skeleton className="w-[90%]" />
      <Skeleton className="w-3/4" />
      <Skeleton className="w-4/5" />
    </Card>
  );
}
