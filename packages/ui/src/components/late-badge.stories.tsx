import type { Meta, StoryObj } from '@storybook/react-vite';

import { LateBadge } from './late-badge';

const meta = {
  title: 'Verification/LateBadge',
  component: LateBadge,
} satisfies Meta<typeof LateBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
