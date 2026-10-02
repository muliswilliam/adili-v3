import type { Meta, StoryObj } from '@storybook/react-vite';

import { DeclarationSummary } from './declaration-summary';
import { BUILDING_ID, WANJIKU_DECLARATION } from './fixtures/declaration';

const meta = {
  title: 'Review/DeclarationSummary',
  component: DeclarationSummary,
  args: {
    document: WANJIKU_DECLARATION,
    version: 2,
    className: 'max-w-[760px] rounded-2xl bg-card shadow-card',
  },
} satisfies Meta<typeof DeclarationSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Read-only, attachments listed by name. */
export const AsFiled: Story = {};

/** In the case view: an item a reviewer was sent to, and attachments that download. */
export const GoToItem: Story = {
  args: {
    highlight: BUILDING_ID,
    onAttachment: () => undefined,
    attachmentState: (uploadId) =>
      uploadId === '0192f1a0-5a11-7000-8000-00000000e101' ? 'busy' : 'idle',
  },
};
