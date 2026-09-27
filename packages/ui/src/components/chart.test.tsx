import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Chart, type ChartProps } from './chart';

type Fixture = ChartProps & { title: string };

const percent = (value: number) => `${value.toFixed(1)}%`;

const byCommission: Fixture = {
  kind: 'bar',
  title: 'Filing rate by Commission, 2027',
  categoryLabel: 'Commission',
  series: [{ key: 'filing', label: 'Filing rate' }],
  data: [
    { label: 'Public Service Commission', values: { filing: 91.2 } },
    { label: 'Judicial Service Commission', values: { filing: null } },
    { label: 'Teachers Service Commission', values: { filing: 84.5 } },
  ],
  max: 100,
  formatValue: percent,
};

const nationalTrend: Fixture = {
  kind: 'line',
  title: 'National filing and compliance rate by year',
  categoryLabel: 'Year',
  series: [
    { key: 'filing', label: 'Filing rate' },
    { key: 'compliance', label: 'Compliance rate' },
  ],
  data: [
    { label: '2025', values: { filing: 80, compliance: 70 } },
    { label: '2026', values: { filing: null, compliance: 72 } },
    { label: '2027', values: { filing: 91.2, compliance: 75 } },
  ],
  max: 100,
  formatValue: percent,
};

describe('Chart', () => {
  describe.each([
    ['bar', byCommission],
    ['line', nationalTrend],
  ] as const)('as a %s chart', (_kind, props) => {
    it('is a figure named by its visible title', () => {
      render(<Chart {...props} />);

      const figure = screen.getByRole('figure', { name: props.title });
      expect(figure.querySelector('figcaption')?.textContent).toBe(props.title);
    });

    it('hides the drawing from assistive tech and exposes a data table instead', () => {
      const { container } = render(<Chart {...props} />);

      expect(container.querySelector('[data-chart-plot]')?.getAttribute('aria-hidden')).toBe(
        'true',
      );
      const table = screen.getByRole('table', { name: props.title });
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((cell) => cell.textContent),
      ).toEqual([props.categoryLabel, ...props.series.map((series) => series.label)]);
      expect(
        within(table)
          .getAllByRole('rowheader')
          .map((cell) => cell.textContent),
      ).toEqual(props.data.map((datum) => datum.label));
    });

    it('keeps the table visually hidden until asked to show it', () => {
      const { rerender } = render(<Chart {...props} />);
      expect(screen.getByRole('table').closest('[data-chart-table]')?.className).toContain(
        'sr-only',
      );

      rerender(<Chart {...props} showTable />);
      expect(screen.getByRole('table').closest('[data-chart-table]')?.className).not.toContain(
        'sr-only',
      );
    });
  });

  describe('bar chart', () => {
    it('draws a bar scaled to the maximum for each value', () => {
      const { container } = render(<Chart {...byCommission} />);

      const bars = container.querySelectorAll<HTMLElement>('[data-chart-bar]');
      expect(Array.from(bars, (bar) => bar.style.width)).toEqual(['91.2%', '84.5%']);
    });

    it('does not plot suppressed values and says so in the table', () => {
      const { container } = render(<Chart {...byCommission} />);

      const suppressedRow = screen.getByRole('row', { name: /Judicial Service Commission/ });
      expect(within(suppressedRow).getByRole('cell').textContent).toBe('Not shown');
      expect(container.querySelectorAll('[data-chart-bar]')).toHaveLength(2);
    });

    it('lets the caller supply the suppressed marker', () => {
      render(<Chart {...byCommission} suppressedLabel="Fewer than 10" />);

      const suppressedRow = screen.getByRole('row', { name: /Judicial Service Commission/ });
      expect(within(suppressedRow).getByRole('cell').textContent).toBe('Fewer than 10');
    });

    it('formats values in the table', () => {
      render(<Chart {...byCommission} />);

      const row = screen.getByRole('row', { name: /Public Service Commission/ });
      expect(within(row).getByRole('cell').textContent).toBe('91.2%');
    });
  });

  describe('line chart', () => {
    it('breaks each line at suppressed values and plots no point for them', () => {
      const { container } = render(<Chart {...nationalTrend} />);

      const filing = container.querySelectorAll('[data-chart-series="filing"] [data-chart-line]');
      const compliance = container.querySelectorAll(
        '[data-chart-series="compliance"] [data-chart-line]',
      );
      expect(filing).toHaveLength(0);
      expect(compliance).toHaveLength(1);
      expect(
        container.querySelectorAll('[data-chart-series="filing"] [data-chart-point]'),
      ).toHaveLength(2);
      expect(
        container.querySelectorAll('[data-chart-series="compliance"] [data-chart-point]'),
      ).toHaveLength(3);
    });

    it('places points by category and value', () => {
      const { container } = render(<Chart {...nationalTrend} />);

      const points = container.querySelectorAll<HTMLElement>(
        '[data-chart-series="compliance"] [data-chart-point]',
      );
      expect(Array.from(points, (point) => [point.style.left, point.style.top])).toEqual([
        ['0%', '30%'],
        ['50%', '28%'],
        ['100%', '25%'],
      ]);
    });

    it('shows a legend when there is more than one series', () => {
      const { container } = render(<Chart {...nationalTrend} />);

      const legend = container.querySelector('[data-chart-legend]');
      expect(legend?.textContent).toContain('Filing rate');
      expect(legend?.textContent).toContain('Compliance rate');
    });
  });

  it('shows no legend for a single series', () => {
    const { container } = render(<Chart {...byCommission} />);

    expect(container.querySelector('[data-chart-legend]')).toBeNull();
  });

  it('renders an empty table and nothing plotted when there is no data', () => {
    const { container } = render(<Chart {...byCommission} data={[]} />);

    expect(screen.queryAllByRole('rowheader')).toHaveLength(0);
    expect(container.querySelectorAll('[data-chart-bar]')).toHaveLength(0);
  });

  it('centres a single category on a line chart', () => {
    const { container } = render(
      <Chart
        {...nationalTrend}
        data={[{ label: '2027', values: { filing: 91.2, compliance: 75 } }]}
      />,
    );

    const points = container.querySelectorAll<HTMLElement>('[data-chart-point]');
    expect(Array.from(points, (point) => point.style.left)).toEqual(['50%', '50%']);
    expect(container.querySelectorAll('[data-chart-line]')).toHaveLength(0);
  });

  it('draws nothing for a line chart whose values are all suppressed', () => {
    const { container } = render(
      <Chart
        {...nationalTrend}
        data={nationalTrend.data.map((datum) => ({
          label: datum.label,
          values: { filing: null, compliance: null },
        }))}
      />,
    );

    expect(container.querySelectorAll('[data-chart-line], [data-chart-point]')).toHaveLength(0);
    expect(screen.getAllByRole('cell').every((cell) => cell.textContent === 'Not shown')).toBe(
      true,
    );
  });

  it('explains line gaps in the legend so sighted users see why a point is missing', () => {
    const single = { ...nationalTrend, series: [{ key: 'filing', label: 'Filing rate' }] };
    const { container, rerender } = render(<Chart {...single} suppressedLabel="Fewer than 10" />);

    expect(container.querySelector('[data-chart-gap-key]')?.textContent).toBe('Fewer than 10');

    rerender(
      <Chart
        {...single}
        data={nationalTrend.data.filter((datum) => datum.values.filing !== null)}
      />,
    );
    expect(container.querySelector('[data-chart-legend]')).toBeNull();
  });

  it('passes other props to the figure', () => {
    render(<Chart {...byCommission} id="filing-chart" data-testid="chart" />);

    expect(screen.getByTestId('chart').id).toBe('filing-chart');
  });

  it('works out a rounded maximum when none is given', () => {
    const { container } = render(<Chart {...byCommission} max={undefined} />);

    // 91.2 rounds up to 100, so bars keep their percentages.
    const bars = container.querySelectorAll<HTMLElement>('[data-chart-bar]');
    expect(bars[0]?.style.width).toBe('91.2%');
  });
});
