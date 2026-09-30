import type { Meta, StoryObj } from '@storybook/react-vite';

import { ReminderHistory, type ReminderHistoryEntry } from './reminder-history';

const meta = {
  title: 'Obligations/ReminderHistory',
  component: ReminderHistory,
  decorators: [
    (Story) => (
      <div className="max-w-170">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReminderHistory>;

export default meta;
type Story = StoryObj<typeof meta>;

const reminders: ReminderHistoryEntry[] = [
  {
    offsetDays: 30,
    scheduledAt: '2027-12-01T09:14:00.000Z',
    sentAt: '2027-12-01T09:14:06.000Z',
    channels: ['sms', 'email'],
    outcome: 'sent',
  },
  {
    offsetDays: 14,
    scheduledAt: '2027-12-17T09:14:00.000Z',
    sentAt: null,
    channels: [],
    outcome: 'skipped-no-contact',
  },
  {
    offsetDays: 7,
    scheduledAt: '2027-12-24T09:14:00.000Z',
    sentAt: null,
    channels: [],
    outcome: 'skipped-missed',
  },
];

/** Every outcome kind: sent, skipped on purpose, missed. */
export const History: Story = { args: { reminders } };

export const PastAtCreation: Story = {
  args: {
    reminders: [
      {
        offsetDays: 30,
        scheduledAt: '2027-05-01T21:00:00.000Z',
        sentAt: null,
        channels: [],
        outcome: 'skipped-past-due-at-creation',
      },
      {
        offsetDays: 14,
        scheduledAt: '2027-05-17T09:14:00.000Z',
        sentAt: null,
        channels: [],
        outcome: 'failed',
      },
    ],
  },
};

export const Loading: Story = { args: { reminders: null } };

export const Empty: Story = { args: { reminders: [] } };

export const LoadError: Story = {
  args: {
    reminders: null,
    error: {
      title: 'Reminder history could not be loaded',
      detail: 'Check your connection and try again.',
    },
    onRetry: () => undefined,
  },
};

export const NotFound: Story = {
  args: {
    reminders: null,
    error: { title: 'This obligation is no longer on record.', tone: 'warning', retry: false },
  },
};
