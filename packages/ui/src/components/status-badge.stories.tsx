import type { Meta, StoryObj } from '@storybook/react-vite';

import { StatusBadge } from './status-badge';

const meta = {
  title: 'Obligations/StatusBadge',
  component: StatusBadge,
  args: { variant: 'neutral', children: 'Upcoming' },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};

export const Info: Story = { args: { variant: 'info', children: 'Due' } };

export const Warning: Story = { args: { variant: 'warning', children: 'Overdue' } };

export const Success: Story = { args: { variant: 'success', children: 'Filed' } };

export const WithoutIcon: Story = { args: { variant: 'info', children: 'Due', icon: null } };

export const EveryVariant: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <StatusBadge variant="neutral">Upcoming</StatusBadge>
      <StatusBadge variant="info">Due</StatusBadge>
      <StatusBadge variant="warning">Overdue</StatusBadge>
      <StatusBadge variant="success">Filed</StatusBadge>
    </div>
  ),
};
