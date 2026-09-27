import { type ComponentProps, type ReactNode, useId } from 'react';

import { chartAxis, lineSegments, tidy } from '../lib/chart-scale';
import { cn } from '../lib/cn';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

export interface ChartSeries {
  key: string;
  label: string;
}

/** One category (a Commission, a year) with a value per series key; null means suppressed. */
export interface ChartDatum {
  label: string;
  values: Record<string, number | null>;
}

export type ChartProps = Omit<ComponentProps<'figure'>, 'title' | 'children'> & {
  kind: 'bar' | 'line';
  /** Shown above the chart and names both the figure and its data table. */
  title: string;
  /** Header of the table's first column, e.g. "Commission" or "Year". */
  categoryLabel: string;
  series: readonly ChartSeries[];
  data: readonly ChartDatum[];
  /** Axis maximum, e.g. 100 for rates. Defaults to the largest value rounded up. */
  max?: number;
  formatValue?: (value: number) => string;
  /** Stands in for a suppressed (null) value, which is never plotted. */
  suppressedLabel?: ReactNode;
  /** Show the data table on screen too. It is always available to assistive tech. */
  showTable?: boolean;
};

// Static class names so Tailwind can see them. Series cycle through these in order; `ai` is left
// out because that colour means AI-assisted content.
const SERIES_COLORS = [
  { fill: 'bg-brand', stroke: 'stroke-brand' },
  { fill: 'bg-info', stroke: 'stroke-info' },
  { fill: 'bg-secondary-foreground', stroke: 'stroke-secondary-foreground' },
  { fill: 'bg-success', stroke: 'stroke-success' },
] as const;

const numberFormat = new Intl.NumberFormat('en-KE');
const defaultFormat = (value: number) => numberFormat.format(value);

function colorOf(seriesIndex: number) {
  return SERIES_COLORS[seriesIndex % SERIES_COLORS.length] ?? SERIES_COLORS[0];
}

function seriesValue(datum: ChartDatum, key: string): number | null {
  return datum.values[key] ?? null;
}

/** A value as a percentage of the axis, clamped to the plot. */
function percentOf(value: number, max: number): number {
  return tidy(Math.min(100, Math.max(0, (value / max) * 100)));
}

interface PlotProps {
  series: readonly ChartSeries[];
  data: readonly ChartDatum[];
  max: number;
  ticks: number[];
  /** Renders a value, or the suppressed label for null. */
  display: (value: number | null) => ReactNode;
  formatValue: (value: number) => string;
}

/**
 * A simple bar or line chart with an accessible data table. The drawing is hidden from assistive
 * tech, which reads the table instead; suppressed (null) values are left out of the drawing and
 * shown as `suppressedLabel`. Bars are horizontal so long category names fit on phones.
 */
export function Chart({
  kind,
  title,
  categoryLabel,
  series,
  data,
  max,
  formatValue = defaultFormat,
  suppressedLabel = 'Not shown',
  showTable = false,
  className,
  ...props
}: ChartProps) {
  const titleId = useId();
  const values = data.flatMap((datum) => series.map((s) => seriesValue(datum, s.key)));
  const axis = chartAxis(Math.max(0, ...values.map((value) => value ?? 0)), max);
  const display = (value: number | null) => (value === null ? suppressedLabel : formatValue(value));
  const plot: PlotProps = { series, data, ...axis, display, formatValue };
  // Bars say "suppressed" inline; a line only shows a gap, so the legend explains it.
  const showsGapKey = kind === 'line' && values.includes(null);

  return (
    <figure aria-labelledby={titleId} className={cn('flex flex-col gap-3', className)} {...props}>
      <figcaption id={titleId} className="text-sm font-medium text-foreground">
        {title}
      </figcaption>
      <div data-chart-plot="" aria-hidden="true" className="flex flex-col gap-3">
        {(series.length > 1 || showsGapKey) && (
          <ul
            data-chart-legend=""
            className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary-foreground"
          >
            {series.length > 1 &&
              series.map((s, seriesIndex) => (
                <li key={s.key} className="flex items-center gap-1.5">
                  <span className={cn('size-2.5 rounded-sm', colorOf(seriesIndex).fill)} />
                  {s.label}
                </li>
              ))}
            {showsGapKey && (
              <li className="flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-dashed border-muted-foreground" />
                <span data-chart-gap-key="">{suppressedLabel}</span>
              </li>
            )}
          </ul>
        )}
        {kind === 'bar' ? <BarPlot {...plot} /> : <LinePlot {...plot} />}
      </div>
      <div data-chart-table="" className={cn(!showTable && 'sr-only')}>
        <Table caption={title}>
          <TableHeader>
            <TableRow>
              <TableHead>{categoryLabel}</TableHead>
              {series.map((s) => (
                <TableHead key={s.key} className="text-right">
                  {s.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((datum) => (
              <TableRow key={datum.label}>
                <TableHead scope="row">{datum.label}</TableHead>
                {series.map((s) => {
                  const value = seriesValue(datum, s.key);
                  return (
                    <TableCell
                      key={s.key}
                      className={cn(
                        'text-right tabular-nums',
                        value === null && 'text-muted-foreground',
                      )}
                    >
                      {display(value)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </figure>
  );
}

function BarPlot({ series, data, max, display }: PlotProps) {
  return (
    // Subgrids share one value column, so every track ends at the same place whatever the label.
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-3">
      {data.map((datum) => (
        <div key={datum.label} className="col-span-2 grid grid-cols-subgrid gap-y-1">
          <span className="col-span-2 text-sm text-foreground">{datum.label}</span>
          {series.map((s, seriesIndex) => {
            const value = seriesValue(datum, s.key);
            return (
              <div
                key={s.key}
                data-chart-series={s.key}
                className="col-span-2 grid grid-cols-subgrid items-center"
              >
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  {value !== null && (
                    <div
                      data-chart-bar=""
                      className={cn('h-full rounded-full', colorOf(seriesIndex).fill)}
                      style={{ width: `${percentOf(value, max)}%` }}
                    />
                  )}
                </div>
                <span className="text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  {display(value)}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function LinePlot({ series, data, max, ticks, formatValue }: PlotProps) {
  const xOf = (datumIndex: number) =>
    data.length > 1 ? tidy((datumIndex / (data.length - 1)) * 100) : 50;
  const yOf = (value: number) => tidy(100 - percentOf(value, max));
  const lastIndex = data.length - 1;

  return (
    <div className="flex gap-2">
      {/* Ticks are evenly spaced, so a flex column lines them up with the grid and sizes the axis
          to its widest label. The 8px overhang centres the end labels on the plot's edges. */}
      <div className="-my-2 flex h-52 shrink-0 flex-col-reverse justify-between text-right text-xs leading-4 text-muted-foreground tabular-nums">
        {ticks.map((tick) => (
          <span key={tick}>{formatValue(tick)}</span>
        ))}
      </div>
      <div className="min-w-0 flex-1 px-1">
        <div className="relative h-48">
          {ticks.map((tick) => (
            <div
              key={tick}
              className="absolute inset-x-0 border-t border-border"
              style={{ top: `${yOf(tick)}%` }}
            />
          ))}
          {/* Stretched to the box; non-scaling strokes keep lines crisp at any width. */}
          <svg
            className="absolute inset-0 size-full overflow-visible"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {series.map((s, seriesIndex) => (
              <g key={s.key} data-chart-series={s.key} className={colorOf(seriesIndex).stroke}>
                {lineSegments(data.map((datum) => seriesValue(datum, s.key)))
                  .filter((segment) => segment.length > 1)
                  .map((segment) => (
                    <polyline
                      key={segment[0]?.index}
                      data-chart-line=""
                      fill="none"
                      strokeWidth={2}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      points={segment
                        .map((point) => `${xOf(point.index)},${yOf(point.value)}`)
                        .join(' ')}
                    />
                  ))}
              </g>
            ))}
          </svg>
          {/* Points are HTML so they stay round when the plot stretches. */}
          {series.map((s, seriesIndex) => (
            <div key={s.key} data-chart-series={s.key}>
              {data.map((datum, datumIndex) => {
                const value = seriesValue(datum, s.key);
                if (value === null) return null;
                return (
                  <span
                    key={datum.label}
                    data-chart-point=""
                    className={cn(
                      'absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card',
                      colorOf(seriesIndex).fill,
                    )}
                    style={{ left: `${xOf(datumIndex)}%`, top: `${yOf(value)}%` }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="relative mt-1.5 h-4 text-xs text-muted-foreground">
          {data.map((datum, datumIndex) => (
            <span
              key={datum.label}
              // End labels align inwards so they never spill past the plot on narrow screens.
              className={cn(
                'absolute whitespace-nowrap',
                lastIndex > 0 && datumIndex === 0
                  ? 'translate-x-0'
                  : lastIndex > 0 && datumIndex === lastIndex
                    ? '-translate-x-full'
                    : '-translate-x-1/2',
              )}
              style={{ left: `${xOf(datumIndex)}%` }}
            >
              {datum.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
