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
    it('shows its title and gives assistive tech that title once, on the data table', () => {
      render(<Chart {...props} />);

      const figure = screen.getByRole('figure');
      expect(figure.querySelector('figcaption')?.textContent).toBe(props.title);
      expect(screen.getByRole('table', { name: props.title })).toBeTruthy();
      expect(screen.queryByRole('figure', { name: props.title })).toBeNull();
      const announced = screen
        .getAllByText(props.title)
        .filter((element) => !element.closest('[aria-hidden="true"]'));
      expect(announced).toHaveLength(1);
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

    it('shows the table instead of the drawing when asked', () => {
      const { container } = render(<Chart {...props} tableOnly />);

      expect(container.querySelector('[data-chart-plot]')).toBeNull();
      expect(screen.getByRole('table').closest('[data-chart-table]')?.className).not.toContain(
        'sr-only',
      );
      expect(screen.getByText(props.title, { selector: 'figcaption' })).toBeTruthy();
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

    it('leaves a plain break across suppressed and missing values, with nothing joining it', () => {
      const single = { ...nationalTrend, series: [{ key: 'filing', label: 'Filing rate' }] };
      const { container } = render(
        <Chart
          {...single}
          data={[
            { label: '2024', values: { filing: 78 } },
            { label: '2025', values: { filing: 80 } },
            { label: '2026', values: { filing: null } },
            { label: '2027', values: {} },
            { label: '2028', values: { filing: 91.2 } },
            { label: '2029', values: { filing: 93 } },
          ]}
        />,
      );

      const lines = container.querySelectorAll('polyline');
      expect(Array.from(lines, (line) => line.getAttribute('points'))).toEqual([
        '0,22 20,20',
        '80,8.8 100,7',
      ]);
      expect(container.querySelector('[stroke-dasharray]')).toBeNull();
      expect(container.querySelector('[data-chart-legend]')).toBeNull();
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

  it('passes other props to the figure', () => {
    render(<Chart {...byCommission} id="filing-chart" data-testid="chart" />);

    expect(screen.getByTestId('chart').id).toBe('filing-chart');
  });

  it('labels a value missing from the data as no data, not as suppressed', () => {
    const { container } = render(
      <Chart
        {...byCommission}
        data={[
          { label: 'Public Service Commission', values: { filing: 91.2 } },
          { label: 'National Police Service Commission', values: {} },
        ]}
      />,
    );

    const missingRow = screen.getByRole('row', { name: /National Police Service Commission/ });
    expect(within(missingRow).getByRole('cell').textContent).toBe('No data');
    expect(container.querySelectorAll('[data-chart-bar]')).toHaveLength(1);
  });

  it('treats a value that is not a finite number as no data, never plotting it', () => {
    const { container } = render(
      <Chart
        {...byCommission}
        data={[
          { label: 'Public Service Commission', values: { filing: 91.2 } },
          { label: 'National Police Service Commission', values: { filing: NaN } },
        ]}
      />,
    );

    const row = screen.getByRole('row', { name: /National Police Service Commission/ });
    expect(within(row).getByRole('cell').textContent).toBe('No data');
    const bars = container.querySelectorAll<HTMLElement>('[data-chart-bar]');
    expect(Array.from(bars, (bar) => bar.style.width)).toEqual(['91.2%']);
  });

  it('draws every category when two share a label', () => {
    const { container } = render(
      <Chart
        {...nationalTrend}
        data={[
          { label: '2027', values: { filing: 80, compliance: 70 } },
          { label: '2027', values: { filing: 90, compliance: 75 } },
        ]}
      />,
    );

    expect(screen.getAllByRole('rowheader')).toHaveLength(2);
    expect(container.querySelectorAll('[data-chart-point]')).toHaveLength(4);
  });

  it('renders an empty line chart without plotting or labelling anything', () => {
    const { container } = render(<Chart {...nationalTrend} data={[]} />);

    expect(screen.queryAllByRole('rowheader')).toHaveLength(0);
    expect(
      container.querySelectorAll('[data-chart-line], [data-chart-point], [data-chart-x-label]'),
    ).toHaveLength(0);
  });

  it('thins year labels on a long line so they do not overlap on phones', () => {
    const years = Array.from({ length: 12 }, (_, index) => `${2016 + index}/${17 + index}`);
    const { container } = render(
      <Chart
        {...nationalTrend}
        data={years.map((label, index) => ({
          label,
          values: { filing: 70 + index, compliance: 60 + index },
        }))}
      />,
    );

    const labels = Array.from(
      container.querySelectorAll('[data-chart-x-label]'),
      (label) => label.textContent,
    );
    expect(labels.length).toBeLessThanOrEqual(4);
    expect(labels.at(-1)).toBe('2027/28');
    // Every category still has a point and a table row.
    expect(container.querySelectorAll('[data-chart-point]')).toHaveLength(24);
    expect(screen.getAllByRole('rowheader')).toHaveLength(12);
  });

  it('labels every category on a short line', () => {
    const { container } = render(<Chart {...nationalTrend} />);

    expect(
      Array.from(container.querySelectorAll('[data-chart-x-label]'), (label) => label.textContent),
    ).toEqual(['2025', '2026', '2027']);
  });

  it('works out a rounded maximum when none is given', () => {
    const { container } = render(<Chart {...byCommission} max={undefined} />);

    // 91.2 rounds up to 100, so bars keep their percentages.
    const bars = container.querySelectorAll<HTMLElement>('[data-chart-bar]');
    expect(bars[0]?.style.width).toBe('91.2%');
  });
});
