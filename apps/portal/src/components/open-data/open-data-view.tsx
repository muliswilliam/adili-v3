import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  Chart,
  type ChartDatum,
  EmptyState,
  formatNumber,
  Icon,
  ReleaseStatusBadge,
  SegmentedChoice,
  Select,
  SelectItem,
  StatTile,
} from '@adili/ui';
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  BanIcon,
  ChartBarLineIcon,
  ChartIncreaseIcon,
  Clock01Icon,
  Download04Icon,
  RefreshIcon,
  SecurityCheckIcon,
  Table01Icon,
  WifiDisconnected01Icon,
} from '@hugeicons/core-free-icons';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

import {
  kindName,
  type Language,
  type PageCopy,
  pageCopy,
  langParam,
  SWAHILI_RELEASE_STATUS,
} from '../../open-data/copy';
import {
  type ChartMetric,
  commissionBars,
  financialYear,
  financialYearShort,
  formatDay,
  formatRate,
  headline,
} from '../../open-data/model';
import type {
  OpenDataPage,
  OpenDataPageResult,
  ReleaseSelection,
} from '../../server/open-data.server';
import type { OpenDataRelease } from '../../server/reporting/types';
import { DownloadsCard } from './open-data-downloads';
import { PageCard } from './page-card';
import { OpenDataHeading } from './open-data-shell';
import { TablesCard } from './open-data-tables';
import { Unshown } from './unshown';

export interface OpenDataViewProps {
  page: OpenDataPageResult;
  language: Language;
  onRetry: () => void;
}

/** The search of a page of /open-data: the release shown and the language. */
export interface OpenDataSearch extends ReleaseSelection {
  lang?: 'sw';
}

const searchOf = (selection: ReleaseSelection, language: Language): OpenDataSearch => ({
  ...selection,
  lang: langParam(language),
});

/**
 * The public Open data page (spec 09b FE-4, S11): the release selector with its status, the
 * withdrawn banner, the headline figures, the rates by Commission and the national trend (each
 * with its table), the six tables with the suppression legend, and the downloads with the
 * release's verification. Also its empty, rate-limited, unavailable and not-found states.
 */
export function OpenDataView({ page, language, onRetry }: OpenDataViewProps) {
  const copy = pageCopy(language);
  const navigate = useNavigate();
  const go = (selection: ReleaseSelection, lang: Language = language) => {
    void navigate({ to: '/open-data', search: searchOf(selection, lang) });
  };
  const current: ReleaseSelection =
    page.status === 'ok'
      ? { fy: page.release.fy, kind: page.release.kind, version: page.release.version }
      : {};

  return (
    <>
      <OpenDataHeading
        title={copy.title}
        language={language}
        onLanguage={(next) => {
          go(current, next);
        }}
      />
      {page.status === 'ok' ? (
        <ReleasePage page={page} language={language} copy={copy} onSelect={go} />
      ) : (
        <Card className="p-0 sm:p-0">
          <Unavailable page={page} copy={copy} language={language} onRetry={onRetry} />
        </Card>
      )}
    </>
  );
}

function Unavailable({
  page,
  copy,
  language,
  onRetry,
}: {
  page: Exclude<OpenDataPageResult, OpenDataPage>;
  copy: PageCopy;
  language: Language;
  onRetry: () => void;
}) {
  const retry = (
    <Button variant="secondary" onClick={onRetry}>
      <Icon icon={RefreshIcon} />
      {copy.retry}
    </Button>
  );
  switch (page.status) {
    case 'empty':
      return (
        <EmptyState
          className="py-14"
          icon={<Icon icon={ChartBarLineIcon} />}
          title={copy.noneTitle}
          description={copy.none}
        />
      );
    case 'not-found':
      return (
        <EmptyState
          className="py-14"
          icon={<Icon icon={ChartBarLineIcon} />}
          title={copy.notFoundTitle}
          description={copy.notFound}
          action={
            <Button asChild variant="secondary">
              <Link to="/open-data" search={searchOf({}, language)}>
                {copy.latest}
              </Link>
            </Button>
          }
        />
      );
    case 'rate-limited':
      return (
        <div role="alert">
          <EmptyState
            className="py-14"
            tone="destructive"
            icon={<Icon icon={Clock01Icon} />}
            title={copy.rateTitle}
            description={copy.rate(page.retryAfterSeconds)}
            action={retry}
          />
        </div>
      );
    case 'unavailable':
      return (
        <div role="alert">
          <EmptyState
            className="py-14"
            tone="destructive"
            icon={<Icon icon={WifiDisconnected01Icon} />}
            title={copy.errorTitle}
            description={copy.error}
            action={retry}
          />
        </div>
      );
  }
}

function ReleasePage({
  page,
  language,
  copy,
  onSelect,
}: {
  page: OpenDataPage;
  language: Language;
  copy: PageCopy;
  onSelect: (selection: ReleaseSelection) => void;
}) {
  const { release } = page;
  return (
    <div className="grid gap-5">
      {release.status === 'withdrawn' ? (
        <WithdrawnBanner release={release} language={language} copy={copy} />
      ) : null}
      <ReleaseBar page={page} language={language} copy={copy} onSelect={onSelect} />
      <Headline page={page} copy={copy} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <CommissionChart page={page} language={language} copy={copy} />
        <TrendChart page={page} language={language} copy={copy} />
      </div>
      {/* Keyed by release: the cycle, sort and page chosen belong to the release shown. */}
      <TablesCard key={release.id} page={page} language={language} />
      <DownloadsCard release={release} language={language} />
    </div>
  );
}

function WithdrawnBanner({
  release,
  language,
  copy,
}: {
  release: OpenDataRelease;
  language: Language;
  copy: PageCopy;
}) {
  return (
    <Alert variant="destructive" className="sm:flex sm:items-start sm:gap-4">
      <Icon icon={BanIcon} />
      <div className="min-w-0 flex-1">
        <AlertTitle className="font-semibold">
          {copy.withdrawnTitle(formatDay(release.withdrawnAt ?? release.publishedAt, language))}
        </AlertTitle>
        <AlertDescription>
          {copy.reason}: {release.withdrawnReason}
          {release.correctedVersion === null ? ` ${copy.noCorrectionYet}` : null}
        </AlertDescription>
      </div>
      {release.correctedVersion !== null ? (
        <Button asChild variant="secondary" size="sm" className="mt-2.5 sm:mt-0">
          <Link
            to="/open-data"
            search={searchOf(
              { fy: release.fy, kind: release.kind, version: release.correctedVersion },
              language,
            )}
          >
            {copy.viewCorrected(release.correctedVersion)}
          </Link>
        </Button>
      ) : null}
    </Alert>
  );
}

const choiceKey = (fy: number, kind: string) => `${String(fy)}-${kind}`;

function ReleaseBar({
  page,
  language,
  copy,
  onSelect,
}: {
  page: OpenDataPage;
  language: Language;
  copy: PageCopy;
  onSelect: (selection: ReleaseSelection) => void;
}) {
  const { release } = page;
  const fieldLabel = 'mb-1.5 block text-[13px] font-medium text-secondary-foreground';
  return (
    <Card className="flex-row flex-wrap items-end gap-x-4 gap-y-3 p-4 sm:p-4">
      <div className="w-full sm:w-72">
        <span id="od-release" className={fieldLabel}>
          {copy.release}
        </span>
        <Select
          aria-labelledby="od-release"
          value={choiceKey(release.fy, release.kind)}
          // Radix fills the value in once its options mount; until then (server render) the
          // placeholder says the same.
          placeholder={`${financialYear(release.fy)} · ${kindName(release.kind, language)}`}
          onValueChange={(value) => {
            const choice = page.choices.find((each) => choiceKey(each.fy, each.kind) === value);
            if (choice) onSelect(choice);
          }}
        >
          {page.choices.map((choice) => (
            <SelectItem
              key={choiceKey(choice.fy, choice.kind)}
              value={choiceKey(choice.fy, choice.kind)}
            >
              {financialYear(choice.fy)} · {kindName(choice.kind, language)}
            </SelectItem>
          ))}
        </Select>
      </div>
      {page.versions.length > 1 ? (
        <div className="w-full sm:w-60">
          <span id="od-version" className={fieldLabel}>
            {copy.version}
          </span>
          <Select
            aria-labelledby="od-version"
            value={String(release.version)}
            placeholder={copy.versionOption(release.version, release.status === 'withdrawn')}
            onValueChange={(value) => {
              onSelect({ fy: release.fy, kind: release.kind, version: Number(value) });
            }}
          >
            {page.versions.map(({ version, status }) => (
              <SelectItem key={version} value={String(version)}>
                {copy.versionOption(version, status === 'withdrawn')}
              </SelectItem>
            ))}
          </Select>
        </div>
      ) : null}
      {/* Status and actions wrap together, below the selectors when the row is full. */}
      <div className="flex min-w-0 flex-[1_1_auto] flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex h-11 items-center gap-2.5 text-sm text-secondary-foreground">
          <ReleaseStatusBadge
            status={release.status}
            messages={language === 'sw' ? SWAHILI_RELEASE_STATUS : undefined}
          />
          <span>{copy.publishedOn(formatDay(release.publishedAt, language))}</span>
        </div>
        <div className="flex h-11 items-center gap-1.5">
          <Button asChild variant="secondary" size="sm">
            <a href={release.verifyUrl} target="_blank" rel="noopener noreferrer">
              <Icon icon={SecurityCheckIcon} />
              {copy.verify}
            </a>
          </Button>
          <Button asChild variant="ghost" size="icon">
            <a href="#downloads" aria-label={copy.goToDownloads} title={copy.goToDownloads}>
              <Icon icon={Download04Icon} />
            </a>
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Headline({ page, copy }: { page: OpenDataPage; copy: PageCopy }) {
  const figures = headline(page.tables['national-totals'].rows);
  const count = (value: number | null) => (value === null ? copy.noFigure : formatNumber(value));
  const tile = (label: string, value: number | null, rate: boolean, description: ReactNode) => (
    <StatTile
      label={label}
      value={value ?? Number.NaN}
      format={(shown) =>
        Number.isNaN(shown) ? copy.noFigure : rate ? formatRate(shown) : formatNumber(shown)
      }
      description={description}
    />
  );
  return (
    <section aria-label={copy.headline} className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {tile(
        copy.declarationRate,
        figures.filingRate,
        true,
        copy.commissionsReported(count(figures.commissionsReported), count(figures.commissions)),
      )}
      {tile(copy.declarationsMade, figures.filed, false, copy.ofExpected(count(figures.expected)))}
      {tile(
        copy.complianceRate,
        figures.complianceRate,
        true,
        copy.determinations(count(figures.determinations)),
      )}
      {tile(copy.referrals, figures.referrals, false, copy.actions(count(figures.actions)))}
    </section>
  );
}

function ViewToggle({
  table,
  onToggle,
  copy,
}: {
  table: boolean;
  onToggle: () => void;
  copy: PageCopy;
}) {
  return (
    <Button variant="ghost" size="sm" aria-pressed={table} onClick={onToggle}>
      <Icon icon={table ? ChartBarLineIcon : Table01Icon} />
      {table ? copy.showChart : copy.showTable}
    </Button>
  );
}

const SHORT_LIST = 8;

function CommissionChart({
  page,
  language,
  copy,
}: {
  page: OpenDataPage;
  language: Language;
  copy: PageCopy;
}) {
  const [metric, setMetric] = useState<ChartMetric>('filing');
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const [all, setAll] = useState(false);
  const [table, setTable] = useState(false);
  const threshold = page.tables['filing-by-commission'].suppression.threshold;
  const bars = commissionBars(page.tables, metric, order);
  const shown = all ? bars : bars.slice(0, SHORT_LIST);
  const figures = headline(page.tables['national-totals'].rows);
  const national = metric === 'filing' ? figures.filingRate : figures.complianceRate;
  const measure = metric === 'filing' ? copy.declarationRate : copy.complianceRate;

  return (
    <PageCard
      id="by-commission"
      title={copy.byCommission}
      tools={
        <SegmentedChoice
          variant="track"
          legend={copy.measure}
          value={metric}
          onValueChange={(value) => {
            setMetric(value === 'compliance' ? 'compliance' : 'filing');
          }}
          options={[
            { value: 'filing', label: copy.declarationRate },
            { value: 'compliance', label: copy.complianceRate },
          ]}
        />
      }
    >
      <div className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          onClick={() => {
            setOrder(order === 'desc' ? 'asc' : 'desc');
          }}
        >
          <Icon icon={order === 'desc' ? ArrowDown01Icon : ArrowUp01Icon} />
          {order === 'desc' ? copy.highestFirst : copy.lowestFirst}
        </Button>
        {national !== null ? (
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {copy.national(formatRate(national))}
          </span>
        ) : null}
        <span className="flex-1" />
        <ViewToggle
          table={table}
          copy={copy}
          onToggle={() => {
            setTable(!table);
          }}
        />
      </div>
      <Chart
        kind="bar"
        title={copy.chartTitle(measure, financialYear(page.release.fy))}
        categoryLabel={copy.commission}
        series={[{ key: 'rate', label: measure }]}
        data={shown.map((bar): ChartDatum => ({
          label: bar.name,
          // A gap the chart does not draw: null (suppressed) or no value (not reported).
          values:
            bar.gap === 'not-reported' ? {} : { rate: bar.rate === null ? null : bar.rate * 100 },
        }))}
        max={100}
        formatValue={(value) => formatRate(value / 100)}
        suppressedLabel={<Unshown kind="suppressed" threshold={threshold} language={language} />}
        missingLabel={<Unshown kind="not-reported" threshold={threshold} language={language} />}
        tableOnly={table}
      />
      <p className="text-[12.5px] text-muted-foreground">
        {copy.chartNote}
        {metric === 'compliance' ? ` ${copy.noDeterminations}` : null}
      </p>
      {bars.length > SHORT_LIST ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setAll(!all);
            }}
          >
            {all ? copy.showFewer : copy.showAll(bars.length)}
          </Button>
        </div>
      ) : null}
    </PageCard>
  );
}

function TrendChart({
  page,
  language,
  copy,
}: {
  page: OpenDataPage;
  language: Language;
  copy: PageCopy;
}) {
  const [table, setTable] = useState(false);
  const enough = page.trend.length >= 2;
  return (
    <PageCard
      id="trend"
      title={copy.trend}
      tools={
        enough ? (
          <ViewToggle
            table={table}
            copy={copy}
            onToggle={() => {
              setTable(!table);
            }}
          />
        ) : null
      }
    >
      {enough ? (
        <Chart
          kind="line"
          title={copy.trendTitle}
          categoryLabel={copy.financialYear}
          series={[
            { key: 'filing', label: copy.declarationRate },
            { key: 'compliance', label: copy.complianceRate },
          ]}
          data={page.trend.map((point) => {
            const figures = headline(point.totals);
            const percent = (value: number | null) => (value === null ? null : value * 100);
            return {
              label: financialYearShort(point.fy),
              values: {
                filing: percent(figures.filingRate),
                compliance: percent(figures.complianceRate),
              },
            };
          })}
          max={100}
          formatValue={(value) => formatRate(value / 100)}
          suppressedLabel={
            <Unshown
              kind="suppressed"
              threshold={page.tables['national-totals'].suppression.threshold}
              language={language}
            />
          }
          tableOnly={table}
        />
      ) : (
        <EmptyState
          className="py-8"
          icon={<Icon icon={ChartIncreaseIcon} />}
          title={copy.trendEmptyTitle}
          description={copy.trendEmpty}
        />
      )}
    </PageCard>
  );
}
