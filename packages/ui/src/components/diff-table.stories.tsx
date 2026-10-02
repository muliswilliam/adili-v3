import type { Meta, StoryObj } from '@storybook/react-vite';

import { DiffTable, type DiffTableGroup } from './diff-table';

// The prototype's demo statement (07a-review #primitives).
const groups: DiffTableGroup[] = [
  {
    id: 'assets',
    label: 'Assets',
    rows: [
      {
        id: 'house',
        item: 'Building',
        detail: '4-bedroom house on LR 12715/482',
        match: 'matched',
        previousCents: 1_200_000_000,
        currentCents: 1_690_000_000,
        deltaPercent: 40.83,
        note: 'Not marked',
      },
      {
        id: 'savings',
        item: 'Bank and cash',
        detail: 'KCB Junior savings account',
        match: 'matched',
        previousCents: 0,
        currentCents: 4_500_000,
        deltaPercent: null,
      },
      {
        id: 'land',
        item: 'Land',
        detail: '0.5 acre plot, Nyeri',
        match: 'matched',
        previousCents: 240_000_000,
        currentCents: 240_000_000,
        deltaPercent: 0,
      },
      {
        id: 'fund',
        item: 'Investments',
        detail: 'CIC Money Market Fund units',
        match: 'only-current',
        previousCents: null,
        currentCents: 85_000_000,
        note: 'not marked',
      },
      {
        id: 'car',
        item: 'Vehicle',
        detail: 'Toyota Probox, KBZ 771A',
        match: 'only-previous',
        previousCents: 60_000_000,
        currentCents: null,
        note: 'not marked',
      },
    ],
  },
  {
    id: 'liabilities',
    label: 'Liabilities',
    rows: [
      {
        id: 'mortgage',
        item: 'Mortgage',
        detail: 'HFC Bank',
        match: 'matched',
        previousCents: 710_000_000,
        currentCents: 630_000_000,
        deltaPercent: -11.27,
      },
    ],
  },
];

const meta = {
  title: 'Review/DiffTable',
  component: DiffTable,
  args: {
    groups,
    previousVersion: 1,
    currentVersion: 2,
    caption: 'Changes for Wanjiku Njeri Kamau between version 1 and version 2',
  },
} satisfies Meta<typeof DiffTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Statement: Story = {};

/** No percentage when the previous value was zero: "n/a" with the reason on hover or focus. */
export const NullPercentage: Story = {
  args: { groups: [{ id: 'assets', label: 'Assets', rows: groups[0]?.rows.slice(1, 2) ?? [] }] },
};

export const NilInBothVersions: Story = {
  args: { groups: [{ id: 'assets', label: 'Assets', rows: [] }] },
};
