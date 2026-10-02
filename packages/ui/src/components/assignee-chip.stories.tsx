import type { Meta, StoryObj } from '@storybook/react-vite';

import { AssigneeChip } from './assignee-chip';

const meta = {
  title: 'Review/AssigneeChip',
  component: AssigneeChip,
  args: { name: 'Peter Mwangi' },
} satisfies Meta<typeof AssigneeChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AnotherOfficer: Story = {};

export const CurrentUser: Story = { args: { name: 'Faith Achieng', current: true } };

/** In a queue table cell. */
export const CurrentUserCompact: Story = {
  args: { name: 'Faith Achieng', current: true, compact: true },
};

export const Unassigned: Story = { args: { name: null } };

export const EveryState: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <AssigneeChip name="Faith Achieng" current />
      <AssigneeChip name="Peter Mwangi" />
      <AssigneeChip name={null} />
      <AssigneeChip name="Faith Achieng" current compact />
    </div>
  ),
};
