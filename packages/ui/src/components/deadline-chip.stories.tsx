import type { Meta, StoryObj } from '@storybook/react-vite';

import { DeadlineChip } from './deadline-chip';

const DAY_MS = 86_400_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

// Due soon from the first reminder: 10 days left of 30 for a Form K decision.
const meta = {
  title: 'Access/DeadlineChip',
  component: DeadlineChip,
  args: { due: inDays(16), label: 'Decision due', soonDays: 10 },
} satisfies Meta<typeof DeadlineChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Due: Story = {};

export const DueSoon: Story = { args: { due: inDays(3) } };

export const DueToday: Story = { args: { due: inDays(0) } };

export const EndsToday: Story = {
  args: { due: inDays(0), label: 'Download until', soonDays: 3, todayText: 'Ends today' },
};

export const Late: Story = { args: { due: inDays(-7) } };

export const Met: Story = { args: { due: inDays(-7), met: 'Decided 26 Sep' } };

export const EveryState: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <DeadlineChip {...args} due={inDays(16)} />
      <DeadlineChip {...args} due={inDays(3)} />
      <DeadlineChip {...args} due={inDays(0)} />
      <DeadlineChip {...args} due={inDays(-7)} />
      <DeadlineChip {...args} due={inDays(-7)} met="Decided 26 Sep" />
    </div>
  ),
};
