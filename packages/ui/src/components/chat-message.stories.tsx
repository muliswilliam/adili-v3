import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { userEvent, within } from 'storybook/test';

import { AssistantMessage, UserMessage } from './chat-message';
import type { Citation } from './citation-chip';
import { type Feedback, FeedbackControl } from './feedback-control';

const CITATIONS: Citation[] = [
  {
    id: 'am-24',
    source: 'am',
    citation: 'AM 24',
    title: 'Approximate values',
    snippet:
      'Declare approximate values as at the statement date. A reasonable estimate of what the asset would sell for is enough; a professional valuation is not required.',
    language: 'en',
  },
  {
    id: 'help-value',
    source: 'help',
    citation: 'Help: Valuing assets',
    title: 'Valuing assets',
    snippet:
      'Use what the asset would sell for on the statement date. For a car, compare prices of similar cars; for land, recent sales nearby. A rough figure is fine.',
    language: 'en',
  },
];

const ANSWER =
  'Give an approximate value as at the statement date: roughly what it would sell for then. You do not need a professional valuation.';

const OFFICER = {
  name: 'Joseph Kiplagat',
  email: 'reporting.officer@tsc.go.ke',
  phone: '020 289 2000',
};

function Rating() {
  const [value, setValue] = useState<Feedback | null>(null);
  return (
    <FeedbackControl
      value={value}
      onRate={setValue}
      noteMaxLength={500}
      messages={{ group: 'Rate this answer' }}
      className="items-start"
    />
  );
}

const meta = {
  title: 'AI/AssistantMessage',
  component: AssistantMessage,
  args: { status: 'answered', text: ANSWER, citations: CITATIONS, actions: <Rating /> },
  decorators: [
    (Story) => (
      <div className="flex max-w-[392px] flex-col gap-3.5 bg-background p-4">
        <UserMessage text="How do I value my car?" />
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AssistantMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Before the first words arrive. */
export const Thinking: Story = { args: { status: 'thinking', text: '' } };

/** Words arrive with a caret; each finished sentence is read out once. */
export const Streaming: Story = {
  args: {
    status: 'streaming',
    text: 'Give an approximate value as at the statement date: roughly',
  },
};

export const Answered: Story = {};

/** A citation chip opens its passage under the chips. */
export const CitationExpanded: Story = {
  args: { onReadPassage: () => undefined },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'AM 24' }));
  },
};

/** The corpus cannot support an answer, so the reporting officer is named instead. */
export const Declined: Story = { args: { status: 'declined', text: '', officer: OFFICER } };

/** The stream dropped part-way: what arrived stays, with Try again. */
export const StreamError: Story = {
  args: {
    status: 'error',
    text: 'Give an approximate value as at the statement date: roughly',
    onRetry: () => undefined,
  },
};

/** 429: too many questions in a short time. */
export const RateLimited: Story = { args: { status: 'rate-limited', text: '' } };
