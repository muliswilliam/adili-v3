import type { Meta, StoryObj } from '@storybook/react-vite';

import { DETERMINATION_OUTCOMES, OutcomeBadge } from './outcome-badge';

const meta = {
  title: 'Determinations/OutcomeBadge',
  component: OutcomeBadge,
  args: { outcome: 'compliant' },
} satisfies Meta<typeof OutcomeBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Compliant: Story = {};

export const CompliantNoIssues: Story = { args: { outcome: 'compliant-no-issues' } };

export const NonCompliant: Story = { args: { outcome: 'non-compliant' } };

export const FurtherAction: Story = { args: { outcome: 'further-action' } };

export const EveryOutcome: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2.5">
      {DETERMINATION_OUTCOMES.map((outcome) => (
        <OutcomeBadge key={outcome} outcome={outcome} />
      ))}
    </div>
  ),
};
