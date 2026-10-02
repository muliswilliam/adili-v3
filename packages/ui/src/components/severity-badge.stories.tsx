import type { Meta, StoryObj } from '@storybook/react-vite';

import { SEVERITIES, SeverityBadge } from './severity-badge';

const meta = {
  title: 'Review/SeverityBadge',
  component: SeverityBadge,
  args: { severity: 'high' },
} satisfies Meta<typeof SeverityBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Each severity, as the flags tab groups them. */
export const All: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {SEVERITIES.map((severity) => (
        <SeverityBadge key={severity} severity={severity} />
      ))}
    </div>
  ),
};
