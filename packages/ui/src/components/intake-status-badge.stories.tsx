import type { Meta, StoryObj } from '@storybook/react-vite';

import { INTAKE_STATUSES, IntakeStatusBadge } from './intake-status-badge';

const meta = {
  title: 'Reporting/IntakeStatusBadge',
  component: IntakeStatusBadge,
  args: { status: 'submitted-on-time' },
} satisfies Meta<typeof IntakeStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnTime: Story = {};

export const Late: Story = { args: { status: 'submitted-late' } };

export const NotReported: Story = { args: { status: 'not-reported' } };

export const EveryStatus: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2.5">
      {INTAKE_STATUSES.map((status) => (
        <IntakeStatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};
