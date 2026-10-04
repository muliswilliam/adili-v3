import type { Meta, StoryObj } from '@storybook/react-vite';

import { RateBar } from './rate-bar';

const meta = {
  title: 'Reporting/RateBar',
  component: RateBar,
  args: { declared: 42, expected: 50 },
} satisfies Meta<typeof RateBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AtThreshold: Story = {};

export const Low: Story = { args: { declared: 291, expected: 412 } };

export const Critical: Story = { args: { declared: 7, expected: 19 } };

export const Large: Story = {
  args: { size: 'lg', showCounts: false, declared: 9_412, expected: 10_206 },
};

export const NoneExpected: Story = { args: { declared: 0, expected: 0 } };

export const EveryTone: Story = {
  render: () => (
    <div className="grid max-w-[420px] gap-4">
      <RateBar declared={48} expected={50} />
      <RateBar declared={291} expected={412} />
      <RateBar declared={7} expected={19} />
      <RateBar declared={9_412} expected={10_206} size="lg" showCounts={false} />
      <RateBar declared={0} expected={0} />
    </div>
  ),
};
