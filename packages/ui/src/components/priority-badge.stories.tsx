import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent } from 'storybook/test';

import { PriorityBadge } from './priority-badge';

const meta = {
  title: 'Review/PriorityBadge',
  component: PriorityBadge,
  args: { band: 'high' },
} satisfies Meta<typeof PriorityBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Focus or hover it for the note: an indicator for ordering only, not a finding. */
export const High: Story = {};

export const Medium: Story = { args: { band: 'medium' } };

export const Low: Story = { args: { band: 'low' } };

/** The three bands side by side, as in the queue. */
export const AllBands: Story = {
  render: (args) => (
    <div className="flex flex-wrap gap-2.5">
      <PriorityBadge {...args} band="high" />
      <PriorityBadge {...args} band="medium" />
      <PriorityBadge {...args} band="low" />
    </div>
  ),
};

/** The tooltip, as keyboard focus opens it. */
export const TooltipOpen: Story = {
  play: async () => {
    await userEvent.tab();
  },
};

/** Where the note is already on screen: no tooltip and no tab stop. */
export const WithoutTooltip: Story = { args: { tooltip: false } };
