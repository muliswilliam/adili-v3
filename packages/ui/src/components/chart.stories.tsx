import type { Meta, StoryObj } from '@storybook/react-vite';

import { Chart } from './chart';

const percent = (value: number) => `${value.toFixed(1)}%`;

const meta = {
  title: 'Open data/Chart',
  component: Chart,
  args: {
    kind: 'bar',
    title: 'Filing rate by Commission, 2027',
    categoryLabel: 'Commission',
    series: [{ key: 'filing', label: 'Filing rate' }],
    data: [
      { label: 'Public Service Commission', values: { filing: 91.2 } },
      { label: 'Judicial Service Commission', values: { filing: null } },
      { label: 'Teachers Service Commission', values: { filing: 84.5 } },
      { label: 'National Police Service Commission', values: {} },
    ],
    max: 100,
    formatValue: percent,
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Chart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One track per Commission; the suppressed and missing values are listed, never drawn. */
export const Bar: Story = {};

export const BarTwoSeries: Story = {
  args: {
    series: [
      { key: 'filing', label: 'Filing rate' },
      { key: 'compliance', label: 'Compliance rate' },
    ],
    data: [
      { label: 'Public Service Commission', values: { filing: 91.2, compliance: 75 } },
      { label: 'Judicial Service Commission', values: { filing: null, compliance: 72 } },
      { label: 'Teachers Service Commission', values: { filing: 84.5, compliance: 70 } },
    ],
  },
};

/** The line breaks at the suppressed and missing years, with nothing joining it. */
export const Line: Story = {
  args: {
    kind: 'line',
    title: 'National filing and compliance rate by year',
    categoryLabel: 'Year',
    series: [
      { key: 'filing', label: 'Filing rate' },
      { key: 'compliance', label: 'Compliance rate' },
    ],
    data: [
      { label: '2023', values: { filing: 76, compliance: 64 } },
      { label: '2024', values: { filing: 78, compliance: 66 } },
      { label: '2025', values: { filing: 80, compliance: 70 } },
      { label: '2026', values: { filing: null, compliance: 72 } },
      { label: '2027', values: { compliance: 74 } },
      { label: '2028', values: { filing: 91.2, compliance: 75 } },
    ],
  },
};

/** A long line labels at most four years, always the latest. */
export const LongLine: Story = {
  args: {
    ...Line.args,
    data: Array.from({ length: 12 }, (_, index) => ({
      label: `${2016 + index}/${17 + index}`,
      values: { filing: 70 + index * 2, compliance: 60 + index * 1.5 },
    })),
  },
};

/** No `max`: the axis rounds the largest count up to a round number. */
export const Counts: Story = {
  args: {
    title: 'Declarations filed by Commission, 2027',
    series: [{ key: 'filed', label: 'Declarations filed' }],
    data: [
      { label: 'Public Service Commission', values: { filed: 48312 } },
      { label: 'Teachers Service Commission', values: { filed: 31207 } },
      { label: 'Judicial Service Commission', values: { filed: 1234 } },
    ],
    max: undefined,
    formatValue: undefined,
  },
};

/** The data table assistive tech reads, on screen too. */
export const WithTable: Story = { args: { showTable: true } };
