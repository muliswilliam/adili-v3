import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { SegmentedChoice } from './segmented-choice';

const meta = {
  title: 'Forms/SegmentedChoice',
  component: SegmentedChoice,
  args: {
    legend: 'Marital status',
    options: [
      { value: 'single', label: 'Single' },
      { value: 'married', label: 'Married' },
      { value: 'widowed', label: 'Widowed' },
    ],
    value: 'married',
    onValueChange: () => undefined,
  },
  render: function Render(args) {
    const [value, setValue] = useState(args.value);
    return <SegmentedChoice {...args} value={value} onValueChange={setValue} />;
  },
} satisfies Meta<typeof SegmentedChoice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Buttons: Story = {};

export const WithError: Story = {
  args: {
    value: null,
    hint: 'As on the statement date.',
    error: 'Choose your marital status',
  },
};

/** A compact filter in a toolbar; the legend is for screen readers only. */
export const Track: Story = {
  args: {
    variant: 'track',
    legend: 'Onboarded',
    options: [
      { value: 'any', label: 'Any' },
      { value: 'yes', label: 'Onboarded' },
      { value: 'no', label: 'Not onboarded' },
    ],
    value: 'any',
  },
};
