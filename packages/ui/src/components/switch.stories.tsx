import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Switch } from './switch';

const meta = {
  title: 'Forms/Switch',
  component: Switch,
  args: { checked: false, label: 'Compare with version 1', onCheckedChange: () => undefined },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {};

export const On: Story = { args: { checked: true } };

export const Disabled: Story = { args: { disabled: true } };

export const Blocked: Story = {
  args: {
    label: 'Compare with previous declaration',
    blockedReason: 'First declaration on Adili: nothing to compare.',
  },
};

function InteractiveSwitch(args: Parameters<typeof Switch>[0]) {
  const [checked, setChecked] = useState(false);
  return <Switch {...args} checked={checked} onCheckedChange={setChecked} />;
}

export const Interactive: Story = { render: (args) => <InteractiveSwitch {...args} /> };
