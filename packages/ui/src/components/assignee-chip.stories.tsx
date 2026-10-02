import type { Meta, StoryObj } from '@storybook/react-vite';

import { AssigneeChip } from './assignee-chip';

const FAITH = { subject: 'faith', name: 'Faith Achieng' };
const PETER = { subject: 'peter', name: 'Peter Mwangi' };

const meta = {
  title: 'Review/AssigneeChip',
  component: AssigneeChip,
  args: { assignee: PETER, viewerSubject: FAITH.subject },
} satisfies Meta<typeof AssigneeChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AnotherOfficer: Story = {};

/** The signed-in officer: brand initials and "(you)". */
export const Me: Story = { args: { assignee: FAITH } };

/** In a queue row or card. */
export const MeCompact: Story = { args: { assignee: FAITH, compact: true } };

export const Unassigned: Story = { args: { assignee: null } };

/** Cut with an ellipsis in a narrow cell. */
export const Narrow: Story = {
  args: { assignee: { subject: 'h', name: 'Halima Abdullahi Mohamed Hassan' } },
  decorators: [
    (Story) => (
      <div className="w-[180px]">
        <Story />
      </div>
    ),
  ],
};
