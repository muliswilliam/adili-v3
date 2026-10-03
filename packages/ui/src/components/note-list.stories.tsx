import type { Meta, StoryObj } from '@storybook/react-vite';

import { NoteList } from './note-list';

const meta = {
  title: 'Review/NoteList',
  component: NoteList,
  args: {
    viewerSubject: 'faith',
    notes: [
      {
        id: '1',
        author: { subject: 'peter', name: 'Peter Mwangi' },
        text: 'Late filing is explained by the HR letter.',
        at: '2026-04-28T08:52:00Z',
      },
      {
        id: '2',
        author: { subject: 'faith', name: 'Faith Achieng' },
        text: 'Checked the NTSA mismatch: the Probox was sold in March.\nAsked for the sale agreement in the clarification.',
        at: '2026-09-25T12:05:00Z',
      },
    ],
  },
  decorators: [
    (Story) => (
      <div className="max-w-[560px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NoteList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Newest first; the signed-in officer's notes get the brand initials. */
export const Default: Story = {};

export const OneNote: Story = {
  args: {
    notes: [
      {
        id: '1',
        author: { subject: 'peter', name: 'Peter Mwangi' },
        text: 'Late filing is explained by the HR letter.',
        at: '2026-04-28T08:52:00Z',
      },
    ],
  },
};
