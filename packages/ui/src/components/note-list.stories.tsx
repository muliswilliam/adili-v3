import { PencilEdit02Icon } from '@hugeicons/core-free-icons';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { EmptyState } from './empty-state';
import { Icon } from './icon';
import { NoteList } from './note-list';

const meta = {
  title: 'Review/NoteList',
  component: NoteList,
  args: {
    className: 'max-w-[560px]',
    notes: [
      {
        id: '1',
        author: 'Peter Mwangi',
        at: '2026-04-28T08:52:00Z',
        text: 'Late filing is explained by the HR letter.',
      },
    ],
  },
} satisfies Meta<typeof NoteList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneNote: Story = {};

export const Several: Story = {
  args: {
    notes: [
      {
        id: '1',
        author: 'Peter Mwangi',
        at: '2026-04-28T08:52:00Z',
        text: 'Late filing is explained by the HR letter.',
      },
      {
        id: '2',
        author: 'Faith Achieng',
        current: true,
        at: '2026-09-25T12:05:00Z',
        text: 'KRA income checked against the payslips: within 6%.\nSpouse business income still to confirm with the declarant.',
      },
    ],
  },
};

export const Empty: Story = {
  args: {
    notes: [],
    empty: (
      <EmptyState
        icon={<Icon icon={PencilEdit02Icon} />}
        title="No notes yet"
        description="Notes help a colleague pick up this case."
      />
    ),
  },
};
