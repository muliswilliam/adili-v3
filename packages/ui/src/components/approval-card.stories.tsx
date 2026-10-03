import {
  BankIcon,
  File01Icon,
  JusticeScale01Icon,
  Notification01Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { ApprovalCard } from './approval-card';
import { Badge } from './badge';
import { Button } from './button';
import { OutcomeBadge } from './outcome-badge';

const NOW = Date.parse('2026-10-03T09:00:00.000Z');

const meta = {
  title: 'Determinations/ApprovalCard',
  component: ApprovalCard,
  args: {
    kind: 'determination',
    icon: JusticeScale01Icon,
    title: 'Jane Wanjiru',
    badge: <OutcomeBadge outcome="compliant" />,
    details: [
      <span key="ref" className="font-mono whitespace-nowrap">
        DCB-TSC-2026-0012044-A
      </span>,
      'Teachers Service Commission',
    ],
    proposer: 'Kevin Omondi',
    proposedAt: '2026-09-30T06:00:00.000Z',
    now: NOW,
    summary:
      'All declared assets and income reconcile with the registries. The one flag (a vehicle transfer) was explained in the clarification response of 12 Sep 2026.',
    decision: (
      <>
        <Button size="sm">Approve</Button>
        <Button size="sm" variant="secondary">
          Return
        </Button>
      </>
    ),
    link: (
      <Button size="sm" variant="ghost">
        Open case
      </Button>
    ),
  },
} satisfies Meta<typeof ApprovalCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Determination: Story = {};

export const WithConsequences: Story = {
  args: {
    consequences: [
      {
        icon: File01Icon,
        title: 'A CMP number is allocated in your name',
        detail: 'Next number: CMP-TSC-2026-0000045-5',
      },
      {
        icon: File01Icon,
        title: 'The decision letter is issued',
        detail: 'Restricted, with a QR code the declarant can verify',
      },
      {
        icon: Notification01Icon,
        title: 'Jane Wanjiru is notified',
        detail: 'By email, SMS and in the portal',
      },
    ],
  },
};

export const YouProposedIt: Story = {
  args: {
    cannotApproveReason: 'proposer',
    actions: (
      <Button size="sm" variant="secondary">
        Reassign
      </Button>
    ),
  },
};

export const SalaryStoppage: Story = {
  args: {
    kind: 'action',
    icon: BankIcon,
    tone: 'destructive',
    title: 'Salary stoppage',
    badge: <Badge variant="destructive">Supervisor only</Badge>,
    details: [
      <b key="name" className="font-medium text-secondary-foreground">
        Peter Otieno
      </b>,
      'Kenya Rural Roads Authority',
      'Biennial 2026 overdue',
    ],
    proposer: undefined,
    proposedAt: '2026-08-20T06:00:00.000Z',
    summaryLabel: 'Earlier steps',
    summary: 'Notice to comply issued 3 Aug 2026 · Warning issued 20 Aug 2026 · no response',
    consequences: [
      {
        icon: BankIcon,
        title: 'Payroll receives a stop_salary instruction',
        detail: 'Effective 1 Oct 2026',
        grave: true,
      },
    ],
    decision: (
      <>
        <Button size="sm">Approve stoppage</Button>
        <Button size="sm" variant="secondary">
          Decline
        </Button>
      </>
    ),
  },
};

export const SupervisorOnly: Story = {
  args: {
    ...SalaryStoppage.args,
    cannotApproveReason: 'role',
    cannotApproveText: 'Only a supervisor can approve a salary stoppage.',
  },
};

export const Referral: Story = {
  args: {
    kind: 'referral',
    icon: Search01Icon,
    tone: 'brand',
    title: 'Samuel Kiprono',
    badge: <Badge variant="brand">Undeclared assets</Badge>,
    details: ['Kenya Ports Authority'],
    proposer: 'the system',
    proposedAt: '2026-10-03T06:00:00.000Z',
  },
};
