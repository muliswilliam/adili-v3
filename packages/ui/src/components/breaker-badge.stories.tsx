import type { Meta, StoryObj } from '@storybook/react-vite';

import { BreakerBadge } from './breaker-badge';

const meta = {
  title: 'Registry/BreakerBadge',
  component: BreakerBadge,
  args: { state: 'closed' },
} satisfies Meta<typeof BreakerBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const HalfOpen: Story = { args: { state: 'half-open' } };

export const Open: Story = { args: { state: 'open' } };

export const EveryState: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2.5">
      <BreakerBadge state="closed" />
      <BreakerBadge state="half-open" />
      <BreakerBadge state="open" />
    </div>
  ),
};
