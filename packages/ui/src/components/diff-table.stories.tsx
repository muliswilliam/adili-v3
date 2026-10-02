import type { Meta, StoryObj } from '@storybook/react-vite';

import { DiffTable } from './diff-table';

const KES = (shillings: number) => shillings * 100;

const meta = {
  title: 'Review/DiffTable',
  component: DiffTable,
  args: {
    caption: 'Changes for Wanjiku Njeri Kamau between version 1 and version 2',
    previousVersion: 1,
    currentVersion: 2,
    groups: [
      {
        id: 'assets',
        label: 'Assets',
        rows: [
          {
            id: 'house',
            label: 'Building',
            description: '4-bedroom house on LR 12715/482',
            previousCents: KES(12_000_000),
            currentCents: KES(16_900_000),
            deltaPercent: 40.83,
            note: 'Not marked',
          },
          {
            id: 'savings',
            label: 'Bank and cash',
            description: 'KCB Junior savings account',
            previousCents: 0,
            currentCents: KES(45_000),
            deltaPercent: null,
          },
          {
            id: 'plot',
            label: 'Land',
            description: '0.5 acre plot, Nyeri',
            previousCents: KES(2_400_000),
            currentCents: KES(2_400_000),
            deltaPercent: 0,
          },
          {
            id: 'fund',
            label: 'Investments',
            description: 'CIC Money Market Fund units',
            previousCents: null,
            currentCents: KES(850_000),
            note: 'marked as acquired',
          },
          {
            id: 'car',
            label: 'Vehicle',
            description: 'Toyota Probox, KBZ 771A',
            previousCents: KES(600_000),
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
            label: 'Mortgage',
            description: 'HFC Bank',
            previousCents: KES(7_100_000),
            currentCents: KES(6_300_000),
            deltaPercent: -11.27,
          },
        ],
      },
    ],
  },
} satisfies Meta<typeof DiffTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Matched and unmatched items, a 25%+ change shaded, a null percentage ("n/a", focus it for why).
 */
export const Default: Story = {};

/** In a narrow pane the table scrolls sideways. */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="max-w-[420px]">
        <Story />
      </div>
    ),
  ],
};
