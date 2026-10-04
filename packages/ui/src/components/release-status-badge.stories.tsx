import type { Meta, StoryObj } from '@storybook/react-vite';

import { RELEASE_STATUSES, ReleaseStatusBadge } from './release-status-badge';

const meta = {
  title: 'Open data/ReleaseStatusBadge',
  component: ReleaseStatusBadge,
  args: { status: 'preview' },
} satisfies Meta<typeof ReleaseStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Preview: Story = {};

export const Published: Story = { args: { status: 'published' } };

export const Withdrawn: Story = { args: { status: 'withdrawn' } };

export const EveryStatus: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2.5">
      {RELEASE_STATUSES.map((status) => (
        <ReleaseStatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};

export const Swahili: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2.5">
      {RELEASE_STATUSES.map((status) => (
        <ReleaseStatusBadge
          key={status}
          status={status}
          messages={{
            preview: 'Onyesho la awali',
            published: 'Imechapishwa',
            withdrawn: 'Imeondolewa',
          }}
        />
      ))}
    </div>
  ),
};
