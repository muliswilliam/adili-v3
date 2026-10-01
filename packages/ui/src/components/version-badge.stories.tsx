import type { Meta, StoryObj } from '@storybook/react-vite';

import { VersionBadge } from './version-badge';

const meta = {
  title: 'Verification/VersionBadge',
  component: VersionBadge,
  args: { version: 2 },
} satisfies Meta<typeof VersionBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {};

export const Current: Story = { args: { state: 'current' } };

export const Superseded: Story = { args: { version: 1, state: 'superseded' } };

export const EveryState: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <VersionBadge version={3} />
      <VersionBadge version={2} state="current" />
      <VersionBadge version={1} state="superseded" />
    </div>
  ),
};
