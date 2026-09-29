import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { userEvent, within } from 'storybook/test';

import { type Feedback, FeedbackControl } from './feedback-control';

const meta = {
  title: 'AI/FeedbackControl',
  component: FeedbackControl,
  args: { value: null },
  render: function Render(args) {
    const [value, setValue] = useState<Feedback | null>(args.value);
    return (
      <div className="max-w-[420px]">
        <FeedbackControl
          {...args}
          value={value}
          onRate={async (feedback) => {
            await args.onRate?.(feedback);
            setValue(feedback);
          }}
        />
      </div>
    );
  },
} satisfies Meta<typeof FeedbackControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotRated: Story = {};

export const Helpful: Story = { args: { value: { rating: 'helpful', reason: null, note: null } } };

/** Pressing it again reopens the form with the reason and note, to change them. */
export const NotHelpfulSent: Story = {
  args: { value: { rating: 'not-helpful', reason: 'too-long', note: null } },
};

/** "Not helpful" opens the form asking what was wrong, with an optional note. */
export const NotHelpfulForm: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Not helpful' }));
  },
};

/** Sending without a reason asks for one. */
export const ReasonMissing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Not helpful' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Send rating' }));
  },
};

/** While a rating saves, the buttons look off and ignore presses but keep focus. */
export const Saving: Story = {
  args: { onRate: () => new Promise<void>(() => undefined) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Helpful' }));
  },
};

/** A save that fails is announced ("Rating not sent. Try again.") and the rating is not kept. */
export const Failed: Story = {
  args: { onRate: () => Promise.reject(new Error('Service unavailable')) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Helpful' }));
  },
};

/** Both buttons and the form are off. */
export const Disabled: Story = { args: { disabled: true } };

/** A supervisor sees the reviewer's rating as text. */
export const ReadOnly: Story = {
  args: {
    readOnly: true,
    ratedBy: 'Faith Achieng',
    value: { rating: 'not-helpful', reason: 'too-long', note: null },
  },
};

export const Named: Story = { args: { messages: { group: 'Rate the summary' } } };
