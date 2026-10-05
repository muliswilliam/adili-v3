import type { Meta, StoryObj } from '@storybook/react-vite';

import { PatternCard, PatternCardSkeleton, type PatternCardProps } from './pattern-card';

// Candidates as the console would format them from reporting.yaml `PatternCandidate.values`.
const RATE_CHANGE: PatternCardProps = {
  kind: 'rate-change',
  subject: 'Nairobi City County Public Service Board',
  value: '34.1%',
  valueLabel: 'non-filer rate',
  comparison: 'from 16.8% in 2025/26, 2.0 times',
};

const CANDIDATES: PatternCardProps[] = [
  RATE_CHANGE,
  {
    kind: 'threshold-breach',
    subject: 'Nakuru County Public Service Board',
    value: '28.6%',
    valueLabel: 'non-filer rate',
    comparison: 'threshold 20%',
  },
  {
    kind: 'chronic-late-reporting',
    subject: 'Mandera County Public Service Board',
    value: '3 years',
    valueLabel: 'reported late running',
    comparison: '2024/25, 2025/26 and 2026/27',
  },
  {
    kind: 'clarification-ratio-outlier',
    subject: 'Teachers Service Commission',
    value: '42.6',
    valueLabel: 'clarifications per 1,000 declarations',
    comparison: 'national 12.1, 3.5 times',
  },
  {
    kind: 'size-band-outlier',
    subject: 'Kisumu County Public Service Board',
    value: '24.0%',
    valueLabel: 'non-filer rate',
    comparison: '8.2% for the 6 others with 1,000 officers or more',
  },
  {
    kind: 'non-reporting',
    subject: 'Parliamentary Service Commission',
    value: '2 years',
    valueLabel: 'without a Form M',
    comparison: '2025/26 and 2026/27',
  },
];

const grid =
  'grid max-w-[1080px] grid-cols-1 gap-3 @min-[760px]:grid-cols-2 @min-[1080px]:grid-cols-3';

const meta = {
  title: 'Reporting/PatternCard',
  component: PatternCard,
  args: { ...RATE_CHANGE, onCite: () => undefined },
  decorators: [
    (Story, { parameters }) =>
      parameters.grid ? (
        <div className="@container">
          <Story />
        </div>
      ) : (
        <div className="max-w-[340px]">
          <Story />
        </div>
      ),
  ],
} satisfies Meta<typeof PatternCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Cited: Story = { args: { cited: true } };

/** For the EACC supervisor and after approval: nothing to cite. */
export const ReadOnly: Story = { args: { onCite: undefined } };

export const National: Story = {
  args: {
    kind: 'threshold-breach',
    subject: 'National',
    value: '21.3%',
    valueLabel: 'non-filer rate',
    comparison: 'threshold 20%',
  },
};

/** Every kind, the second already cited, as on the Notable patterns panel. */
export const EveryKind: Story = {
  parameters: { grid: true },
  render: () => (
    <div className={grid}>
      {CANDIDATES.map((candidate, index) => (
        <PatternCard
          key={candidate.kind}
          {...candidate}
          cited={index === 1}
          onCite={() => undefined}
        />
      ))}
    </div>
  ),
};

export const Loading: Story = {
  parameters: { grid: true },
  render: () => (
    <div className={grid} aria-busy="true">
      <PatternCardSkeleton />
      <PatternCardSkeleton />
      <PatternCardSkeleton />
    </div>
  ),
};
