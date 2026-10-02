import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { type Scope, ScopePicker, type ScopePickerProps } from './scope-picker';

const nothing: Scope = {
  years: [],
  includeSpouses: false,
  includeChildren: false,
  sections: [],
};

const requested: Scope = {
  years: [2026],
  includeSpouses: false,
  includeChildren: false,
  sections: ['income', 'assets', 'liabilities'],
};

function Controlled({ value: initial, ...props }: ScopePickerProps) {
  const [value, setValue] = useState(initial);
  return <ScopePicker {...props} value={value} onChange={setValue} />;
}

const meta = {
  title: 'Access/ScopePicker',
  component: ScopePicker,
  args: { value: nothing, onChange: () => undefined, years: [2025, 2026] },
  render: (args) => <Controlled {...args} />,
} satisfies Meta<typeof ScopePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Everything on offer: Form K and law-enforcement requests alike. */
export const Full: Story = {};

/** A partial grant: only what was requested can be granted. */
export const RestrictedToRequest: Story = {
  args: { value: requested, restrictTo: requested },
};

export const Validation: Story = {
  args: {
    errors: { years: 'Choose at least one year.', sections: 'Choose at least one section.' },
  },
};

export const Disabled: Story = { args: { value: requested, disabled: true } };
