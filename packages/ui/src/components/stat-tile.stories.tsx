import type { Meta, StoryObj } from '@storybook/react-vite';
import { UserRemove01Icon } from '@hugeicons/core-free-icons';
import { useState } from 'react';

import { Icon } from './icon';
import { StatTile, StatTileSkeleton } from './stat-tile';

const byType = (initial: number, biennial: number, final: number) => [
  { label: 'Initial', value: initial },
  { label: 'Biennial', value: biennial },
  { label: 'Final', value: final },
];

const dot = (className: string) => (
  <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${className}`} />
);

const meta = {
  title: 'Obligations/StatTile',
  component: StatTile,
  args: { label: 'Upcoming', value: 48298, breakdown: byType(0, 48298, 0) },
  render: (args) => (
    <div className="max-w-[260px]">
      <StatTile {...args} />
    </div>
  ),
} satisfies Meta<typeof StatTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithBreakdown: Story = {};

export const ValueOnly: Story = { args: { breakdown: undefined } };

export const WithDescription: Story = {
  args: { label: 'Overdue', value: 26, breakdown: undefined, description: 'Since 1 Jan 2028' },
};

export const Warning: Story = {
  args: {
    label: 'Due or overdue but not onboarded',
    value: 48,
    tone: 'warning',
    marker: <Icon icon={UserRemove01Icon} />,
    breakdown: [
      { label: 'Due', value: 29 },
      { label: 'Overdue', value: 19 },
    ],
    breakdownLabel: 'Not onboarded by status',
  },
};

export const Pressed: Story = {
  args: {
    label: 'Due',
    value: 47,
    breakdown: byType(41, 0, 6),
    pressed: true,
    onPressedChange: () => undefined,
  },
};

/** The obligations summary: three tiles filter the list by status; the fourth is a count. */
export const SummaryRow: Story = {
  render: function SummaryRow() {
    const [status, setStatus] = useState<string | null>('overdue');
    const toggle = (key: string) => (pressed: boolean) => {
      setStatus(pressed ? key : null);
    };
    return (
      <div
        role="group"
        aria-label="Summary"
        className="grid max-w-[960px] grid-cols-2 gap-3 md:grid-cols-4"
      >
        <StatTile
          label="Upcoming"
          value={0}
          marker={dot('bg-input')}
          breakdown={byType(0, 0, 0)}
          pressed={status === 'upcoming'}
          onPressedChange={toggle('upcoming')}
        />
        <StatTile
          label="Due"
          value={47}
          marker={dot('bg-info')}
          breakdown={byType(41, 0, 6)}
          pressed={status === 'due'}
          onPressedChange={toggle('due')}
        />
        <StatTile
          label="Overdue"
          value={26}
          marker={dot('bg-warning')}
          breakdown={byType(23, 0, 3)}
          pressed={status === 'overdue'}
          onPressedChange={toggle('overdue')}
        />
        <StatTile
          label="Due or overdue but not onboarded"
          value={48}
          tone="warning"
          marker={<Icon icon={UserRemove01Icon} />}
          breakdown={[
            { label: 'Due', value: 29 },
            { label: 'Overdue', value: 19 },
          ]}
          breakdownLabel="Not onboarded by status"
        />
      </div>
    );
  },
};

/** While the counts load. */
export const Loading: Story = {
  render: () => (
    <div className="grid max-w-[540px] grid-cols-2 gap-3">
      <StatTileSkeleton />
      <StatTileSkeleton lines={2} />
    </div>
  ),
};
