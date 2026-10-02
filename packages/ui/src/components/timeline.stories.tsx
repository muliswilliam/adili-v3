import {
  CheckmarkCircle02Icon,
  File01Icon,
  Flag02Icon,
  PencilEdit02Icon,
  RefreshIcon,
  Shield01Icon,
  UserCheck01Icon,
  UserRemove01Icon,
} from '@hugeicons/core-free-icons';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Timeline, type TimelineEvent } from './timeline';

// 25 Sep 2026, 18:00 in Nairobi.
const NOW = Date.parse('2026-09-25T15:00:00Z');

const events: TimelineEvent[] = [
  {
    id: '1',
    at: '2026-04-12T06:02:00Z',
    title: 'Case created from version 1',
    actor: null,
    icon: File01Icon,
  },
  {
    id: '2',
    at: '2026-04-12T06:03:00Z',
    title: '7 indicators raised · priority medium',
    actor: null,
    icon: Flag02Icon,
  },
  {
    id: '3',
    at: '2026-04-22T07:15:00Z',
    title: 'Claimed by Peter Mwangi',
    actor: 'Peter Mwangi',
    icon: UserCheck01Icon,
    tone: 'info',
  },
  {
    id: '4',
    at: '2026-04-28T08:40:00Z',
    title: 'Indicator reviewed: Filed after the due date',
    actor: 'Peter Mwangi',
    icon: CheckmarkCircle02Icon,
    tone: 'success',
  },
  {
    id: '5',
    at: '2026-05-05T13:20:00Z',
    title: 'Released by Peter Mwangi',
    actor: 'Peter Mwangi',
    icon: UserRemove01Icon,
  },
  {
    id: '6',
    at: '2026-09-02T11:30:00Z',
    title: 'Version 2 processed · indicators recomputed, 1 reviewed indicator kept · priority high',
    actor: null,
    icon: RefreshIcon,
    tone: 'warning',
  },
  {
    id: '7',
    at: '2026-09-02T11:31:00Z',
    title: 'Registries checked',
    actor: null,
    icon: Shield01Icon,
    detail: '5 mismatched, 1 unavailable',
  },
  {
    id: '8',
    at: '2026-09-25T12:05:00Z',
    title: 'Note added',
    actor: 'Faith Achieng',
    icon: PencilEdit02Icon,
  },
];

const meta = {
  title: 'Review/Timeline',
  component: Timeline,
  args: { events, now: NOW },
  decorators: [
    (Story) => (
      <div className="max-w-[520px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Timeline>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A case's timeline: newest first, a list per day. */
export const Default: Story = {};

/** No icons given: each event takes the clock. */
export const DefaultIcons: Story = {
  args: { events: events.map((event) => ({ ...event, icon: undefined })) },
};
