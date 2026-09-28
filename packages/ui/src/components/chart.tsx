import type { ComponentProps, ReactNode } from 'react';

import {
  chartAxis,
  type ChartValue,
  isPlotted,
  labelledIndexes,
  lineSegments,
  roundFloatNoise,
  valueState,
} from '../lib/chart-scale';
import { clamp } from '../lib/clamp';
import { cn } from '../lib/cn';
import { formatNumber } from '../lib/format-number';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

export type { ChartValue } from '../lib/chart-scale';

export interface ChartSeries {
  key: string;
  label: string;
}

/**
 * One category (a Commission, a year) with a value per series key. `null` means suppressed; a key
 * left out, or a number that is not finite, means there is no data. Values are counts and rates:
 * a negative one draws as zero, and the table shows it as given.
 */
export interface ChartDatum {
  label: string;
  values: Record<string, number | null>;
}

export type ChartProps = Omit<ComponentProps<'figure'>, 'title' | 'children'> & {
  kind: 'bar' | 'line';
  /** Shown above the chart. Names the data table, so assistive tech hears it once. */
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
  /** Stands in for a value missing from the data, which is never plotted either. */
  missingLabel?: ReactNode;
  /** Show the data table on screen too. It is always available to assistive tech. */
  showTable?: boolean;
};

// Static class names so Tailwind can see them. Series cycle through these in order. Status
// colours (`success`, `warning`, `destructive`, `ai`) are left out so a series never reads as one.
const SERIES_COLORS = [
  { fill: 'bg-brand', stroke: 'stroke-brand' },
  { fill: 'bg-info', stroke: 'stroke-info' },
  { fill: 'bg-foreground', stroke: 'stroke-foreground' },
  { fill: 'bg-muted-foreground', stroke: 'stroke-muted-foreground' },
] as const;

// Beyond this many categories the line chart labels every nth one, so labels fit on a phone.
const MAX_X_LABELS = 4;

function colorOf(seriesIndex: number) {
  return SERIES_COLORS[seriesIndex % SERIES_COLORS.length] ?? SERIES_COLORS[0];
}

function seriesValue(datum: ChartDatum, key: string): ChartValue {
  return Object.hasOwn(datum.values, key) ? datum.values[key] : undefined;
}

/** A value as a percentage of the axis, clamped to the plot. */
function percentOf(value: number, max: number): number {
  return roundFloatNoise(clamp((value / max) * 100, 0, 100));
}

interface PlotProps {
  series: readonly ChartSeries[];
  data: readonly ChartDatum[];
  /** `values[datumIndex][seriesIndex]`, read once from `data`. */
  values: readonly (readonly ChartValue[])[];
  max: number;
}

interface BarPlotProps extends PlotProps {
  /** Renders a value, or the suppressed or missing label. */
  valueText: (value: ChartValue) => ReactNode;
}

interface LinePlotProps extends PlotProps {
  ticks: number[];
  formatValue: (value: number) => string;
}

/**
 * A simple bar or line chart with an accessible data table. The drawing is hidden from assistive
 * tech, which reads the table instead, named by the same title as the visible caption so the title
 * is announced once; suppressed (null) values are left out of the drawing and
 * shown as `suppressedLabel`. Bars are horizontal so long category names fit on phones.
 */
export function Chart({
  kind,
  title,
  categoryLabel,
  series,
  data,
  max,
  formatValue = formatNumber,
  suppressedLabel = 'Not shown',
  missingLabel = 'No data',
  showTable = false,
  className,
  ...props
}: ChartProps) {
  const values = data.map((datum) => series.map((s) => seriesValue(datum, s.key)));
  const { max: axisMax, ticks } = chartAxis(Math.max(0, ...values.flat().filter(isPlotted)), max);
  const gapLabels = { suppressed: suppressedLabel, missing: missingLabel };
  const valueText = (value: ChartValue) =>
    isPlotted(value) ? formatValue(value) : gapLabels[valueState(value)];
  const plot: PlotProps = { series, data, values, max: axisMax };

  return (
    <figure className={cn('flex flex-col gap-3', className)} {...props}>
      <figcaption aria-hidden="true" className="text-sm font-medium text-foreground">
        {title}
      </figcaption>
      <div data-chart-plot="" aria-hidden="true" className="flex flex-col gap-3">
        {series.length > 1 && (
          <ul
            data-chart-legend=""
            className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary-foreground"
          >
            {series.map((s, seriesIndex) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span className={cn('size-2.5 rounded-sm', colorOf(seriesIndex).fill)} />
                {s.label}
              </li>
            ))}
          </ul>
        )}
        {kind === 'bar' ? (
          <BarPlot {...plot} valueText={valueText} />
        ) : (
          <LinePlot {...plot} ticks={ticks} formatValue={formatValue} />
        )}
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
            {data.map((datum, datumIndex) => (
              // Keyed by position: two categories may share a label.
              <TableRow key={datumIndex}>
                <TableHead scope="row">{datum.label}</TableHead>
                {series.map((s, seriesIndex) => {
                  const value = values[datumIndex]?.[seriesIndex];
                  return (
                    <TableCell
                      key={s.key}
                      className={cn(
                        'text-right tabular-nums',
                        valueState(value) !== 'value' && 'text-muted-foreground',
                      )}
                    >
                      {valueText(value)}
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

function BarPlot({ series, data, values, max, valueText }: BarPlotProps) {
  return (
    // Subgrids share one value column, so every track ends at the same place whatever the label.
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-3">
      {data.map((datum, datumIndex) => (
        <div key={datumIndex} className="col-span-2 grid grid-cols-subgrid gap-y-1">
          <span className="col-span-2 text-sm text-foreground">{datum.label}</span>
          {series.map((s, seriesIndex) => {
            const value = values[datumIndex]?.[seriesIndex];
            return (
              <div
                key={s.key}
                data-chart-series={s.key}
                className="col-span-2 grid grid-cols-subgrid items-center"
              >
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  {isPlotted(value) && (
                    <div
                      data-chart-bar=""
                      className={cn('h-full rounded-full', colorOf(seriesIndex).fill)}
                      style={{ width: `${percentOf(value, max)}%` }}
                    />
                  )}
                </div>
                <span className="text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  {valueText(value)}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function LinePlot({ series, data, values, max, ticks, formatValue }: LinePlotProps) {
  const xOf = (datumIndex: number) =>
    data.length > 1 ? roundFloatNoise((datumIndex / (data.length - 1)) * 100) : 50;
  const yOf = (value: number) => roundFloatNoise(100 - percentOf(value, max));
  const lastIndex = data.length - 1;
  const point = ({ index, value }: { index: number; value: number }) =>
    `${xOf(index)},${yOf(value)}`;
  // End labels align inwards so they never spill past the plot on narrow screens.
  const alignOf = (datumIndex: number) => {
    if (lastIndex > 0 && datumIndex === 0) return 'translate-x-0';
    if (lastIndex > 0 && datumIndex === lastIndex) return '-translate-x-full';
    return '-translate-x-1/2';
  };

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
            {series.map((s, seriesIndex) => {
              const segments = lineSegments(values.map((row) => row[seriesIndex]));
              return (
                <g key={s.key} data-chart-series={s.key} className={colorOf(seriesIndex).stroke}>
                  {segments
                    .filter((segment) => segment.length > 1)
                    .map((segment) => (
                      <polyline
                        key={segment[0]?.index}
                        data-chart-line=""
                        fill="none"
                        strokeWidth={2}
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        points={segment.map(point).join(' ')}
                      />
                    ))}
                </g>
              );
            })}
          </svg>
          {/* Points are HTML so they stay round when the plot stretches. */}
          {series.map((s, seriesIndex) => (
            <div key={s.key} data-chart-series={s.key}>
              {values.map((row, datumIndex) => {
                const value = row[seriesIndex];
                if (!isPlotted(value)) return null;
                return (
                  <span
                    key={datumIndex}
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
          {labelledIndexes(data.length, MAX_X_LABELS).map((datumIndex) => (
            <span
              key={datumIndex}
              data-chart-x-label=""
              className={cn('absolute whitespace-nowrap', alignOf(datumIndex))}
              style={{ left: `${xOf(datumIndex)}%` }}
            >
              {data[datumIndex]?.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
