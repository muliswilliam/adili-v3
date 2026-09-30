import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent } from 'storybook/test';

import { AiLabel, type AiLabelDetails } from './ai-label';

const SUMMARY: AiLabelDetails = {
  task: 'summarize-declaration',
  provider: 'anthropic',
  model: 'claude-opus-5',
  promptVersion: 3,
  generatedAt: '2026-09-02T11:33:00Z',
};

const DRAFT: AiLabelDetails = { ...SUMMARY, task: 'draft-clarification', promptVersion: 1 };

const meta = {
  title: 'AI/AiLabel',
  component: AiLabel,
  args: { details: SUMMARY },
} satisfies Meta<typeof AiLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Focus or hover it for the task, provider, model, prompt version and time. */
export const Default: Story = {};

/** The tooltip, as keyboard focus opens it. */
export const TooltipOpen: Story = {
  play: async () => {
    await userEvent.tab();
  },
};

export const PanelHeader: Story = {
  args: { text: 'AI-assisted · generated 24 days ago for version 2' },
};

export const BlockMark: Story = { args: { text: 'AI', size: 'sm' } };

export const DraftedItem: Story = { args: { details: DRAFT, text: 'AI draft', size: 'sm' } };

/** The reviewer changed the drafted item, so it is theirs now. */
export const Edited: Story = {
  args: { details: DRAFT, text: 'AI draft', size: 'sm', edited: true },
};

/** Cut with an ellipsis in a narrow column; the full text is still its accessible name. */
export const Narrow: Story = {
  args: { text: 'AI-assisted · generated 24 days ago for version 2' },
  decorators: [
    (Story) => (
      <div className="max-w-[180px]">
        <Story />
      </div>
    ),
  ],
};
