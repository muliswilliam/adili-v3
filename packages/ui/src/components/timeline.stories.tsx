import {
  CheckmarkCircle02Icon,
  EyeIcon,
  Flag02Icon,
  MailSend01Icon,
  PencilEdit02Icon,
  UserCheck01Icon,
  WorkflowSquare03Icon,
} from '@hugeicons/core-free-icons';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Timeline, type TimelineEntry } from './timeline';

// 25 Sep 2026 in Nairobi, so the newest day reads "Today" in the Today story.
const NOW = Date.parse('2026-09-25T15:00:00Z');

const caseEvents: TimelineEntry[] = [
  {
    id: '1',
    at: '2026-09-18T05:30:00Z',
    actor: null,
    title: 'Version 1 processed',
    summary: '4 flags raised',
    icon: WorkflowSquare03Icon,
  },
  {
    id: '2',
    at: '2026-09-18T05:47:00Z',
    actor: 'Faith Achieng',
    title: 'Claimed by Faith Achieng',
    icon: UserCheck01Icon,
    tone: 'info',
  },
  {
    id: '3',
    at: '2026-09-18T05:48:00Z',
    actor: 'Faith Achieng',
    title: 'Viewed 3 times by Faith Achieng',
    icon: EyeIcon,
  },
  {
    id: '4',
    at: '2026-09-22T07:10:00Z',
    actor: 'Faith Achieng',
    title: 'Flag reviewed: Income differs from KRA records',
    icon: Flag02Icon,
    tone: 'warning',
  },
  {
    id: '5',
    at: '2026-09-22T07:40:00Z',
    actor: 'Faith Achieng',
    title: 'Clarification CLR-PSC-2026-0000012-4 issued',
    summary: 'Response due 6 Oct 2026',
    icon: MailSend01Icon,
    tone: 'info',
  },
  {
    id: '6',
    at: '2026-09-25T12:05:00Z',
    actor: 'Faith Achieng',
    title: 'Note added',
    icon: PencilEdit02Icon,
  },
  {
    id: '7',
    at: '2026-09-25T12:06:00Z',
    actor: 'Faith Achieng',
    title: 'Viewed 2 times by Faith Achieng',
    icon: EyeIcon,
  },
];

const meta = {
  title: 'Review/Timeline',
  component: Timeline,
  args: {
    entries: caseEvents,
    now: Date.parse('2026-09-30T09:00:00Z'),
    className: 'max-w-[520px]',
  },
} satisfies Meta<typeof Timeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CaseTimeline: Story = {};

export const Today: Story = { args: { now: NOW } };

export const EveryTone: Story = {
  args: {
    entries: [
      { id: 'd', at: '2026-09-25T09:00:00Z', actor: null, title: 'Default', icon: EyeIcon },
      {
        id: 'i',
        at: '2026-09-25T08:00:00Z',
        actor: null,
        title: 'Info',
        icon: UserCheck01Icon,
        tone: 'info',
      },
      {
        id: 's',
        at: '2026-09-25T07:00:00Z',
        actor: null,
        title: 'Success',
        icon: CheckmarkCircle02Icon,
        tone: 'success',
      },
      {
        id: 'w',
        at: '2026-09-25T06:00:00Z',
        actor: null,
        title: 'Warning',
        icon: Flag02Icon,
        tone: 'warning',
      },
      {
        id: 'x',
        at: '2026-09-25T05:00:00Z',
        actor: null,
        title: 'Destructive',
        icon: Flag02Icon,
        tone: 'destructive',
      },
    ],
  },
};
