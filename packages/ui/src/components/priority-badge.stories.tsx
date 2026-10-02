import type { Meta, StoryObj } from '@storybook/react-vite';

import { PriorityBadge } from './priority-badge';

const meta = {
  title: 'Review/PriorityBadge',
  component: PriorityBadge,
  args: { priority: 'high' },
} satisfies Meta<typeof PriorityBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const High: Story = {};

export const Medium: Story = { args: { priority: 'medium' } };

export const Low: Story = { args: { priority: 'low' } };

/** Where the indicator note is already on screen, e.g. the flags banner. */
export const WithoutTooltip: Story = { args: { tooltip: false } };

export const EveryBand: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2.5">
      <PriorityBadge priority="high" />
      <PriorityBadge priority="medium" />
      <PriorityBadge priority="low" />
    </div>
  ),
};
