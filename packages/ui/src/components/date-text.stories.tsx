import type { Meta, StoryObj } from '@storybook/react-vite';

import { DateText } from './date-text';

// 26 Sep 2026, 15:00 in Nairobi, so the stories read the same on any day.
const now = Date.parse('2026-09-26T12:00:00Z');

const meta = {
  title: 'Obligations/DateText',
  component: DateText,
  args: { date: '2026-10-08', now },
} satisfies Meta<typeof DateText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DueIn: Story = {};

export const DueToday: Story = { args: { date: '2026-09-26' } };

export const Overdue: Story = { args: { date: '2026-09-23' } };

export const Opens: Story = { args: { date: '2027-11-01', kind: 'opens' } };

/** S22: calendar days across month ends and the year end; hover a phrase for its date. */
export const AcrossBoundaries: Story = {
  render: () => (
    <table className="text-sm">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="pr-6 pb-2 font-medium">
            Today
          </th>
          <th scope="col" className="pr-6 pb-2 font-medium">
            Due
          </th>
          <th scope="col" className="pb-2 font-medium">
            Renders
          </th>
        </tr>
      </thead>
      <tbody>
        {(
          [
            ['2026-09-30T09:00:00Z', '2026-10-01'],
            ['2026-10-02T09:00:00Z', '2026-09-30'],
            ['2028-02-27T09:00:00Z', '2028-03-01'],
            ['2027-12-19T09:00:00Z', '2027-12-31'],
            ['2026-12-29T09:00:00Z', '2027-01-05'],
            ['2028-01-03T09:00:00Z', '2027-12-31'],
          ] as const
        ).map(([today, due]) => (
          <tr key={today + due}>
            <td className="py-1 pr-6 tabular-nums">{today.slice(0, 10)}</td>
            <td className="py-1 pr-6 tabular-nums">{due}</td>
            <td className="py-1">
              <DateText date={due} now={Date.parse(today)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
};
