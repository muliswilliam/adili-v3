import type { Meta, StoryObj } from '@storybook/react-vite';

import { SuggestedQuestions } from './suggested-questions';

const meta = {
  title: 'AI/SuggestedQuestions',
  component: SuggestedQuestions,
  args: {
    questions: [
      'Do I declare a car I own with my brother?',
      'How do I value my land?',
      'Do I include my SACCO shares?',
    ],
    onAsk: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="max-w-[360px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SuggestedQuestions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Follow-ups under an answer: the heading is for screen readers only. */
export const FollowUps: Story = {
  args: {
    questions: ['What if my brother already declared it?', 'How do I value a car?'],
    label: 'Follow-up questions',
    labelHidden: true,
  },
};

/** While an answer is on its way. */
export const Disabled: Story = { args: { disabled: true } };

export const Kiswahili: Story = {
  args: {
    questions: ['Tamko langu linapaswa kuwasilishwa lini?', 'Ninatangaza kwa ajili ya nani?'],
    label: 'Maswali yanayopendekezwa',
  },
};
