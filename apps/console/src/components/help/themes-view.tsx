import {
  Button,
  Card,
  cn,
  EmptyState,
  formatMonth,
  formatNumber,
  Icon,
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
  Add01Icon,
  Alert02Icon,
  ChartColumnIcon,
  HelpCircleIcon,
  Message01Icon,
  SquareLock02Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';

import type { QuestionThemeCount } from '../../server/declarations/client';
import type { HelpResult } from '../../server/help.server';
import { LoadError } from '../load-error';
import { Page } from '../page';
import { messages as m } from './messages';
import { monthSummary, percent, themeMonths, type ThemesSearch } from './model';
import { HelpHeader } from './parts';
import type { HelpWorkspace } from './scope';

export interface ThemesViewProps {
  workspace: HelpWorkspace;
  /** Every month's counts; null while they load. */
  result: HelpResult<QuestionThemeCount[]> | null;
  search: ThemesSearch;
  onSearchChange: (next: ThemesSearch) => void;
  /** This month in Nairobi, `YYYY-MM`: counted to date, and the month shown by default. */
  thisMonth: string;
}

const monthName = (month: string) => formatMonth(`${month}-01`);

/**
 * Question themes (spec 11 FE-4, S8): how many questions the Commission's declarants asked Ask
 * Adili per theme in a month, and how many the law and the help articles could not answer.
 * Counts only, no text. Commission admins can start an article for a theme.
 */
export function ThemesView({
  workspace,
  result,
  search,
  onSearchChange,
  thisMonth,
}: ThemesViewProps) {
  const id = useId();
  const counts = result?.ok ? result.data : null;
  const month = search.month ?? thisMonth;
  const months = themeMonths(counts ?? [], thisMonth);
  if (!months.includes(month)) months.push(month);
  const summary = counts ? monthSummary(counts, month) : null;
  const canWrite = !workspace.readOnly;
  const label = (each: string) =>
    each === thisMonth ? m.monthToDate(monthName(each)) : monthName(each);

  return (
    <Page>
      <HelpHeader
        workspace={workspace}
        current="themes"
        actions={
          <>
            <label htmlFor={`${id}-month`} className="sr-only">
              {m.monthLabel}
            </label>
            <Select
              id={`${id}-month`}
              value={month}
              disabled={counts === null}
              className="h-10 w-auto min-w-[200px]"
              onValueChange={(value) => {
                onSearchChange({ month: value === thisMonth ? undefined : value });
              }}
            >
              {months.map((each) => (
                <SelectItem key={each} value={each}>
                  {label(each)}
                </SelectItem>
              ))}
            </Select>
          </>
        }
      />
      <p className="mb-3.5 flex items-center gap-2 text-[13px] text-muted-foreground">
        <Icon icon={SquareLock02Icon} className="size-3.5" />
        {m.themesNote}
      </p>
      {result && !result.ok ? (
        <LoadError title={m.themesLoadError} detail={m.loadErrorDetail} retryLabel={m.tryAgain} />
      ) : summary === null ? (
        <ThemesSkeleton />
      ) : summary.rows.length === 0 ? (
        <Card className="p-0 sm:p-0">
          <EmptyState
            icon={<Icon icon={ChartColumnIcon} />}
            title={m.themesEmpty(monthName(month))}
            description={m.themesEmptyText}
          />
        </Card>
      ) : (
        <>
          <div
            role="group"
            aria-label={m.tilesLabel(monthName(month))}
            className="grid gap-3 min-[700px]:grid-cols-3"
          >
            <StatTile
              label={m.tileQuestions}
              value={summary.total}
              marker={<Icon icon={Message01Icon} />}
              description={m.questionsHint}
            />
            <StatTile
              label={m.tileUnanswered}
              value={summary.unanswered}
              marker={<Icon icon={HelpCircleIcon} />}
              description={m.unansweredShare(percent(summary.unanswered, summary.total))}
            />
            <StatTile
              label={m.tileMostUnanswered}
              value={summary.mostUnanswered?.unanswered ?? 0}
              marker={<Icon icon={Alert02Icon} />}
              description={
                summary.mostUnanswered
                  ? `${m.theme[summary.mostUnanswered.theme]} · ${m.ofCount(
                      formatNumber(summary.mostUnanswered.unanswered),
                      formatNumber(summary.mostUnanswered.count),
                    )}`
                  : m.noneUnanswered
              }
            />
          </div>
          <Card className="mt-4 overflow-hidden p-0 sm:p-0">
            <ThemesTable
              month={monthName(month)}
              rows={summary.rows}
              total={summary.total}
              unanswered={summary.unanswered}
              canWrite={canWrite}
            />
          </Card>
        </>
      )}
    </Page>
  );
}

function ThemesTable({
  month,
  rows,
  total,
  unanswered,
  canWrite,
}: {
  month: string;
  rows: QuestionThemeCount[];
  total: number;
  unanswered: number;
  canWrite: boolean;
}) {
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <Table caption={m.themesCaption(month)}>
      <TableHeader>
        <TableRow>
          <TableHead>{m.columnTheme}</TableHead>
          <TableHead className="text-right">{m.columnQuestions}</TableHead>
          <TableHead className="text-right">{m.columnUnanswered}</TableHead>
          <TableHead className="max-sm:hidden">{m.columnShare}</TableHead>
          {canWrite ? (
            <TableHead>
              <span className="sr-only">{m.columnActions}</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.theme}>
            <TableHead scope="row" className="min-w-[200px] font-medium text-foreground">
              {m.theme[row.theme]}
            </TableHead>
            <TableCell className="text-right tabular-nums">{formatNumber(row.count)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatNumber(row.unanswered)}
            </TableCell>
            <TableCell className="min-w-[140px] max-sm:hidden">
              <ShareBar
                width={row.count / max}
                label={m.shareOfQuestions(percent(row.count, total))}
              />
            </TableCell>
            {canWrite ? (
              <TableCell className="text-right whitespace-nowrap">
                <Button asChild variant="ghost" size="sm">
                  <Link
                    to="/help/articles/new"
                    search={{ theme: row.theme }}
                    aria-label={m.articleForThemeLabel(m.theme[row.theme])}
                  >
                    <Icon icon={Add01Icon} />
                    {m.articleForTheme}
                  </Link>
                </Button>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
      <tfoot>
        <TableRow className="border-t bg-[#fcfcfb] font-semibold">
          <TableHead scope="row" className="font-semibold text-foreground">
            {m.allThemes}
          </TableHead>
          <TableCell className="text-right tabular-nums">{formatNumber(total)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatNumber(unanswered)}</TableCell>
          <TableCell className="max-sm:hidden" />
          {canWrite ? <TableCell /> : null}
        </TableRow>
        <TableRow className="bg-warning-subtle font-semibold text-warning-subtle-foreground">
          <TableHead scope="row" className="font-semibold text-inherit">
            <span className="inline-flex items-center gap-1.5">
              <Icon icon={HelpCircleIcon} className="size-3.5" />
              {m.unansweredRow}
            </span>
          </TableHead>
          <TableCell className="text-right tabular-nums">{formatNumber(unanswered)}</TableCell>
          <TableCell className="text-right tabular-nums">
            {`${String(percent(unanswered, total))}%`}
          </TableCell>
          <TableCell className="min-w-[140px] max-sm:hidden">
            <ShareBar
              warn
              width={unanswered / max}
              label={m.shareUnanswered(percent(unanswered, total))}
            />
          </TableCell>
          {canWrite ? <TableCell /> : null}
        </TableRow>
      </tfoot>
    </Table>
  );
}

function ShareBar({
  width,
  label,
  warn = false,
}: {
  width: number;
  label: string;
  warn?: boolean;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className="h-2 min-w-20 overflow-hidden rounded-full bg-muted"
    >
      <i
        className={cn(
          'block h-full rounded-full',
          warn ? 'bg-[#d98a1c]' : 'bg-secondary-foreground',
        )}
        style={{ width: `${String(Math.round(Math.min(1, width) * 100))}%` }}
      />
    </div>
  );
}

function ThemesSkeleton() {
  return (
    <div aria-busy="true">
      <div className="grid gap-3 min-[700px]:grid-cols-3">
        <StatTileSkeleton />
        <StatTileSkeleton />
        <StatTileSkeleton />
      </div>
      <Card className="mt-4 overflow-hidden p-0 sm:p-0">
        <Table caption={m.tabThemes}>
          <TableBody>
            {Array.from({ length: 6 }, (_, row) => (
              <TableRow key={row}>
                <TableCell>
                  <Skeleton className="w-48" />
                </TableCell>
                <TableCell>
                  <Skeleton className="ml-auto w-10" />
                </TableCell>
                <TableCell>
                  <Skeleton className="ml-auto w-10" />
                </TableCell>
                <TableCell>
                  <Skeleton className="w-32" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
