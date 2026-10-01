import type { Meta, StoryObj } from '@storybook/react-vite';

import { Meter } from './meter';

const meta = {
  title: 'Data/Meter',
  component: Meter,
  args: { value: 0.42 },
} satisfies Meta<typeof Meter>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Decorative, beside the printed percentage. */
export const Decorative: Story = {
  render: (args) => (
    <span className="flex items-center gap-2 text-sm tabular-nums">
      <span className="w-10">42%</span>
      <Meter {...args} />
    </span>
  ),
};

/** Named for screen readers when nothing beside it prints the value. */
export const Labelled: Story = { args: { label: 'Cache hit rate', valueText: '42%' } };

export const Empty: Story = { args: { value: 0 } };

export const Full: Story = { args: { value: 1 } };
