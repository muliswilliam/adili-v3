import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { GroundsSelect, type GroundsSelectProps } from './grounds-select';

function Controlled({ value: initial, ...props }: GroundsSelectProps) {
  const [value, setValue] = useState(initial);
  return <GroundsSelect {...props} value={value} onChange={setValue} />;
}

const meta = {
  title: 'Access/GroundsSelect',
  component: GroundsSelect,
  args: { value: [], onChange: () => undefined },
  render: (args) => (
    <div className="max-w-xl">
      <Controlled {...args} />
    </div>
  ),
} satisfies Meta<typeof GroundsSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Chosen: Story = { args: { value: ['frivolous-vexatious', 'not-objectives'] } };

export const Validation: Story = {
  args: { error: 'Choose at least one ground for a partial grant or a denial.' },
};

export const Disabled: Story = { args: { value: ['public-interest'], disabled: true } };
