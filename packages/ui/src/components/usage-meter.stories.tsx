import type { Meta, StoryObj } from '@storybook/react-vite';

import { UsageMeter } from './usage-meter';

const meta = {
  title: 'AI/UsageMeter',
  component: UsageMeter,
  args: { tokensUsed: 1_926_400, monthlyTokens: 3_000_000 },
  decorators: [
    (Story) => (
      <div className="max-w-[360px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UsageMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {};

/** Amber, with an alert icon, from 80%. The notch marks 80%. */
export const High: Story = { args: { tokensUsed: 862_300, monthlyTokens: 1_000_000 } };

export const UsedUp: Story = { args: { tokensUsed: 1_500_000, monthlyTokens: 1_500_000 } };

export const NoneUsed: Story = { args: { tokensUsed: 0, monthlyTokens: 1_000_000 } };

/** A Commission with no budget: any use counts as used up. */
export const NoBudget: Story = { args: { tokensUsed: 1_200, monthlyTokens: 0 } };

/** The 10px bar in a Commission's detail. */
export const Large: Story = { args: { size: 'lg' } };
