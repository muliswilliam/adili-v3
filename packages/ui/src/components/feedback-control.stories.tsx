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
        <FeedbackControl {...args} value={value} onRate={setValue} />
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

/** Both buttons are off while a rating is being saved. */
export const WhileSaving: Story = { args: { disabled: true } };

/** A supervisor sees the reviewer's rating as text. */
export const ReadOnly: Story = {
  args: {
    readOnly: true,
    ratedBy: 'Faith Achieng',
    value: { rating: 'not-helpful', reason: 'too-long', note: null },
  },
};

export const Named: Story = { args: { label: 'Rate the summary' } };
