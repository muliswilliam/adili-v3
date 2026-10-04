import type { Meta, StoryObj } from '@storybook/react-vite';

import { type FigureFormatter, FigureChip, type ResolvedFigure } from './figure-chip';

// What the console's formatter would make of the NCR aggregates for FY 2026/27, by aggregate key.
const FIGURES: Record<string, ResolvedFigure> = {
  'national.filingRate': { label: 'National filing rate 2026/27', value: '91.2%' },
  'national.reportedOnTime': { label: 'Commissions reported on time 2026/27', value: '38' },
  'commission.cpsb047.biennialRate': {
    label: 'Nairobi City CPSB biennial rate 2026/27',
    value: '71.4%',
  },
  'fy2026.commission.cpsb047.nonFilerRate': {
    label: 'Nairobi City CPSB non-filer rate 2025/26',
    value: '16.8%',
  },
  'commission.cpsb032.clarificationRatio': {
    label: 'Nakuru CPSB clarifications per 1,000 declarations 2026/27',
    value: '42.6',
  },
};

const format: FigureFormatter = (key) => FIGURES[key] ?? null;

const meta = {
  title: 'Reporting/FigureChip',
  component: FigureChip,
  args: { aggregateKey: 'national.filingRate', format, onShow: () => undefined },
} satisfies Meta<typeof FigureChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** In a read-only document: plain text, nothing to press. */
export const Static: Story = { args: { onShow: undefined } };

/** A key the formatter cannot resolve. */
export const NotFound: Story = { args: { aggregateKey: 'commission.xyz.initialRate' } };

/** The chips under a narrative paragraph, as `NarrativeEditor`'s `paragraphMeta` would show them. */
export const UnderAParagraph: Story = {
  render: (args) => (
    <div className="flex max-w-[640px] flex-wrap gap-1.5">
      {[...Object.keys(FIGURES), 'commission.xyz.initialRate'].map((key) => (
        <FigureChip key={key} {...args} aggregateKey={key} />
      ))}
    </div>
  ),
};

/** A long label in a narrow column is cut with an ellipsis; the accessible name keeps it whole. */
export const Narrow: Story = {
  args: { aggregateKey: 'commission.cpsb032.clarificationRatio' },
  render: (args) => (
    <div className="w-[260px]">
      <FigureChip {...args} />
    </div>
  ),
};
