import {
  Button,
  Card,
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  EmptyState,
  FilterChip,
  formatDate,
  formatDateTime,
  formatPercent,
  Icon,
  IntakeStatusBadge,
  RateBar,
  Select,
  SelectItem,
  Skeleton,
  StatTile,
  StatTileSkeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Calendar03Icon,
  Clock01Icon,
  DashboardSpeed01Icon,
  Flag02Icon,
  FilterIcon,
  Notification01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useId, useState } from 'react';

import type { IntakePage } from '../../server/eacc-intake';
import type { Intake, IntakeRow, IntakeStatus } from '../../server/reporting/types';
import { problemStatus } from '../../server/service-call';
import { CursorPager } from '../cursor-pager';
import { dueDateOf } from '../form-m/financial-year';
import { InfoTip } from '../info-tip';
import { LoadError, NoAccess } from '../load-error';
import { Page, PageHead } from '../page';
import { clientPage } from '../paging';
import { SearchBox } from '../search-box';
import {
  awaitingReports,
  filterIntake,
  financialYears,
  intakeCounts,
  type IntakeFilters,
  nextChaseOn,
} from './intake-view';
import { messages as m } from './messages';
import { INTAKE_SECTIONS, OutlierChips } from './outlier-chips';

/** Commissions to a page, as in the prototype. */
export const INTAKE_PAGE_SIZE = 10;

/** The intake's search params: the year on show, its filters and the page. */
export interface IntakeSearch extends IntakeFilters {
  fy?: number;
  page?: number;
}

export interface IntakeDashboardProps {
  /** The page; null while it loads. */
  result: IntakePage | null;
  search: IntakeSearch;
  onSearchChange: (next: IntakeSearch) => void;
  /** The row's report as a link to the report viewer, around `children`. */
  reportLink: (row: IntakeRow, children: ReactNode) => ReactNode;
}

const STATUS_CHIPS: readonly IntakeStatus[] = [
  'submitted-on-time',
  'submitted-late',
  'not-reported',
];

/** `search` without empty values, so the URL carries only what is set. */
function compact(search: IntakeSearch): IntakeSearch {
  return Object.fromEntries(
    Object.entries(search).filter(
      ([, value]) => value !== undefined && value !== '' && value !== false,
    ),
  );
}

/** A share (0.9491) as the percentage the rate bars print ("94.9%"). */
const sharePercent = (share: number) => formatPercent(Math.round(share * 1000) / 10);

/**
 * EACC's compliance reports intake (spec 09 FE-3, S9, S10): per financial year, tiles for the
 * Commissions that reported on time, late or not at all and the national declared rate, then
 * every Commission with its status, reference, declared / expected per section, outliers and
 * chases, filtered by status, outliers and a search, ten to a page. A Commission that has not
 * reported opens its chase history; one that has, its report as filed.
 */
export function IntakeDashboard(props: IntakeDashboardProps) {
  const { result, search, onSearchChange } = props;
  if (result && problemStatus(result.intake) === 403) {
    return (
      <Page narrow>
        <PageHead title={m.title} />
        <NoAccess text={m.forbidden} />
      </Page>
    );
  }
  const fy = result?.fy ?? search.fy;
  const intake = result?.intake.ok ? result.intake.data : null;
  return (
    <Page>
      <PageHead
        title={m.title}
        actions={
          result ? (
            <YearSelect
              today={result.today}
              fy={result.fy}
              onChange={(next) => {
                onSearchChange(compact({ ...search, fy: next, page: undefined }));
              }}
            />
          ) : (
            <Skeleton className="h-10 w-64" />
          )
        }
      />
      {result === null ? (
        <IntakeSkeleton />
      ) : !result.intake.ok ? (
        <LoadError
          title={m.loadErrorTitle}
          detail={
            result.intake.error.kind === 'unavailable' && result.intake.error.detail
              ? result.intake.error.detail
              : m.loadErrorDetail
          }
          retryLabel={m.tryAgain}
        />
      ) : intake && fy !== undefined ? (
        <div className="flex flex-col gap-4">
          <Tiles intake={intake} today={result.today} />
          {awaitingReports(intake, result.today) ? (
            <Card className="p-0 sm:p-0">
              <EmptyState
                icon={<Icon icon={Calendar03Icon} />}
                title={m.awaitingTitle(m.fyLabel(intake.fy))}
                description={m.awaitingText(formatDate(dueDateOf(intake.fy)))}
              />
            </Card>
          ) : (
            <IntakeTable
              {...props}
              intake={intake}
              today={result.today}
              search={{ ...search, fy: intake.fy }}
              onSearchChange={(next) => {
                onSearchChange(compact(next));
              }}
            />
          )}
        </div>
      ) : null}
    </Page>
  );
}

function YearSelect({
  today,
  fy,
  onChange,
}: {
  today: string;
  fy: number;
  onChange: (fy: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2.5">
      <label id={`${id}-label`} htmlFor={id} className="text-[13.5px] text-muted-foreground">
        {m.financialYear}
      </label>
      <Select
        id={id}
        aria-labelledby={`${id}-label`}
        value={String(fy)}
        onValueChange={(value) => {
          onChange(Number(value));
        }}
        className="h-10 w-auto min-w-[260px] text-[14.5px]"
      >
        {financialYears(today).map((option) => (
          <SelectItem key={option.fy} value={String(option.fy)}>
            {m.fyOption(m.fyLabel(option.fy), formatDate(option.dueDate), option.current)}
          </SelectItem>
        ))}
      </Select>
    </div>
  );
}

function Tiles({ intake, today }: { intake: Intake; today: string }) {
  const { onTime, late, notReported, nationalDeclaredRate } = intake.totals;
  const nextChase = notReported > 0 ? nextChaseOn(intake, today) : null;
  // A row with the next chase under one value: every tile spans it, so all are as tall.
  const span = nextChase ? 'row-span-3' : undefined;
  return (
    <section
      aria-label={m.tiles}
      className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 min-[1000px]:grid-cols-4"
    >
      <StatTile
        label={m.onTime}
        value={onTime}
        marker={<Icon icon={Tick02Icon} />}
        className={span}
      />
      <StatTile label={m.late} value={late} marker={<Icon icon={Clock01Icon} />} className={span} />
      <StatTile
        label={m.notReported}
        value={notReported}
        marker={<Icon icon={AlertCircleIcon} />}
        description={nextChase ? m.nextChase(formatDate(nextChase)) : undefined}
      />
      <StatTile
        label={m.nationalRate}
        value={nationalDeclaredRate ?? 0}
        format={nationalDeclaredRate === null ? () => m.noRate : sharePercent}
        marker={<Icon icon={DashboardSpeed01Icon} />}
        className={span}
      />
    </section>
  );
}

function IntakeTable({
  intake,
  today,
  search,
  onSearchChange,
  reportLink,
}: Omit<IntakeDashboardProps, 'result'> & { intake: Intake; today: string }) {
  const id = useId();
  const [chased, setChased] = useState<IntakeRow | null>(null);
  const rows = filterIntake(intake.commissions, search);
  const counts = intakeCounts(intake.commissions);
  const page = clientPage(rows, search.page, INTAKE_PAGE_SIZE);
  const applyFilters = (patch: IntakeSearch) => {
    onSearchChange({ ...search, ...patch, page: undefined });
  };
  const goTo = (target: number) => {
    onSearchChange({ ...search, page: target > 1 ? target : undefined });
  };
  const fyLabel = m.fyLabel(intake.fy);
  return (
    <Card className="@container gap-0 overflow-hidden p-0 sm:p-0">
      <div className="flex flex-wrap items-center gap-2.5 border-b px-4 py-3">
        <SearchBox
          id={`${id}-search`}
          label={m.searchLabel}
          placeholder={m.search}
          maxLength={100}
          applied={search.q ?? ''}
          onSearch={(q) => {
            applyFilters({ q });
          }}
        />
        <div role="group" aria-label={m.filters} className="flex flex-wrap items-center gap-1.5">
          <FilterChip
            pressed={!search.status}
            onPressedChange={() => {
              applyFilters({ status: undefined });
            }}
            count={counts.all}
            countLabel={m.commissionsCount}
          >
            {m.all}
          </FilterChip>
          {STATUS_CHIPS.map((status) => (
            <FilterChip
              key={status}
              pressed={search.status === status}
              onPressedChange={(pressed) => {
                applyFilters({ status: pressed ? status : undefined });
              }}
              count={counts[status]}
              countLabel={m.commissionsCount}
            >
              {m.statusChip[status]}
            </FilterChip>
          ))}
        </div>
        <FilterChip
          className="ml-auto"
          icon={Flag02Icon}
          pressed={search.outliers === true}
          onPressedChange={(pressed) => {
            applyFilters({ outliers: pressed || undefined });
          }}
          count={counts.outliers}
          countLabel={m.commissionsCount}
        >
          {m.outliersOnly}
        </FilterChip>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={<Icon icon={FilterIcon} />}
          title={m.noMatchesTitle}
          description={m.noMatchesText}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onSearchChange({ fy: intake.fy });
              }}
            >
              {m.clearFilters}
            </Button>
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table caption={m.caption(fyLabel)} className="min-w-[1040px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[22%]">{m.columnCommission}</TableHead>
                  <TableHead className="w-[17%]">{m.columnStatus}</TableHead>
                  <TableHead>{m.columnInitial}</TableHead>
                  <TableHead>{m.columnBiennial}</TableHead>
                  <TableHead>{m.columnFinal}</TableHead>
                  <TableHead>
                    <span className="inline-flex items-center gap-1">
                      {m.columnOutliers}
                      <InfoTip content={m.outliersHint} label={m.outliersHintLabel} />
                    </span>
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">{m.columnActions}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((row) => (
                  <IntakeLine
                    key={row.commission.slug}
                    row={row}
                    reportLink={reportLink}
                    onChases={() => {
                      setChased(row);
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          {page.pages > 1 ? (
            <CursorPager
              labels={{
                pagination: m.pagination,
                pageRange: (from, to) => m.pageRange(from, to, rows.length),
                pageRows: m.pageRows,
                previousPage: m.previousPage,
                nextPage: m.nextPage,
              }}
              range={{ from: page.from, to: page.to }}
              rows={page.rows.length}
              hasPrevious={page.page > 1}
              hasNext={page.page < page.pages}
              onPrevious={() => {
                goTo(page.page - 1);
              }}
              onNext={() => {
                goTo(page.page + 1);
              }}
            />
          ) : null}
        </>
      )}
      <ChaseDrawer
        row={chased}
        fy={intake.fy}
        nextChase={nextChaseOn(intake, today)}
        onClose={() => {
          setChased(null);
        }}
      />
    </Card>
  );
}

/** "Chased 2 times, last 8 Aug 2026", with a bell; nothing before the first chase. */
function ChaseLine({ chases }: { chases: IntakeRow['chases'] }) {
  if (chases.count === 0 || !chases.lastAt) return null;
  return (
    <span className="mt-1 flex items-start gap-1.5 text-[13px] text-muted-foreground">
      <Icon icon={Notification01Icon} className="mt-0.5 size-3.5 flex-none" />
      {m.chased(chases.count, formatDate(chases.lastAt))}
    </span>
  );
}

function IntakeLine({
  row,
  reportLink,
  onChases,
}: {
  row: IntakeRow;
  reportLink: IntakeDashboardProps['reportLink'];
  onChases: () => void;
}) {
  const reported = row.status !== 'not-reported';
  return (
    <TableRow>
      <TableHead scope="row" className="py-3.5 align-middle font-normal">
        <span className="block font-medium text-foreground">{row.commission.name}</span>
        {row.reference ? (
          <span className="mt-0.5 block font-mono text-[12.5px] tracking-[0.02em] text-muted-foreground">
            {row.reference}
          </span>
        ) : null}
      </TableHead>
      <TableCell className="py-3.5 align-middle">
        <IntakeStatusBadge status={row.status} />
        {row.submittedAt ? (
          <span className="mt-1 block text-[13px] text-muted-foreground">
            <time dateTime={row.submittedAt} title={formatDateTime(row.submittedAt)}>
              {formatDate(row.submittedAt)}
            </time>
          </span>
        ) : null}
        <ChaseLine chases={row.chases} />
      </TableCell>
      {INTAKE_SECTIONS.map((section) => {
        const rate = row.rates[section];
        return (
          <TableCell key={section} className="py-3.5 align-middle">
            {rate ? (
              <RateBar
                declared={rate.declared}
                expected={rate.expected}
                className="max-w-[150px]"
              />
            ) : (
              <span className="text-muted-foreground">{m.none}</span>
            )}
          </TableCell>
        );
      })}
      <TableCell className="py-3.5 align-middle">
        {row.outliers.length > 0 ? (
          <OutlierChips outliers={row.outliers} />
        ) : (
          <span className="text-muted-foreground">{m.none}</span>
        )}
      </TableCell>
      <TableCell className="py-3.5 text-right align-middle">
        {reported && row.reportId ? (
          <Button asChild variant="secondary" size="sm">
            {reportLink(
              row,
              <>
                <span aria-hidden="true">{m.openReport}</span>
                <span className="sr-only">{m.openReportOf(row.commission.name)}</span>
              </>,
            )}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            aria-label={m.chaseHistoryOf(row.commission.name)}
            onClick={onChases}
          >
            {m.chaseHistory}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function ChaseFact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-[14.5px]">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="text-right font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * The chase of a Commission that has not reported: how it is chased, how often so far, when last
 * and next, and when Form M was due. The intake holds the count and the last round only.
 */
function ChaseDrawer({
  row,
  fy,
  nextChase,
  onClose,
}: {
  row: IntakeRow | null;
  fy: number;
  nextChase: string | null;
  onClose: () => void;
}) {
  const due = dueDateOf(fy);
  return (
    <Drawer
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {row ? (
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{row.commission.name}</DrawerTitle>
            <DrawerDescription>{m.chaseTitle(m.fyLabel(fy))}</DrawerDescription>
          </DrawerHeader>
          <DrawerBody className="grid content-start gap-4">
            <IntakeStatusBadge status={row.status} className="justify-self-start" />
            <p className="text-[14.5px] text-secondary-foreground">{m.chaseHow}</p>
            <dl className="divide-y rounded-xl px-4 shadow-card-flat">
              <ChaseFact term={m.chaseReminders}>{m.chaseCount(row.chases.count)}</ChaseFact>
              {row.chases.lastAt ? (
                <ChaseFact term={m.chaseLast}>{formatDateTime(row.chases.lastAt)}</ChaseFact>
              ) : null}
              {row.status === 'not-reported' && nextChase ? (
                <ChaseFact term={m.chaseNext}>{formatDate(nextChase)}</ChaseFact>
              ) : null}
              <ChaseFact term={m.formMDue}>{formatDate(due)}</ChaseFact>
            </dl>
          </DrawerBody>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="secondary">{m.close}</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      ) : null}
    </Drawer>
  );
}

function IntakeSkeleton() {
  return (
    <div aria-busy="true" aria-label={m.loading} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 min-[1000px]:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <StatTileSkeleton key={tile} />
        ))}
      </div>
      <Card aria-hidden="true" className="gap-0 overflow-hidden p-0 sm:p-0">
        {[0, 1, 2, 3, 4, 5].map((line) => (
          <div key={line} className="grid grid-cols-6 gap-6 border-b px-4 py-3.5 last:border-b-0">
            {[0, 1, 2, 3, 4, 5].map((cell) => (
              <Skeleton key={cell} className={cell === 0 ? 'w-4/5' : 'w-3/5'} />
            ))}
          </div>
        ))}
      </Card>
    </div>
  );
}
