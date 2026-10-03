import type { Meta, StoryObj } from '@storybook/react-vite';

import { LadderStepper } from './ladder-stepper';

const meta = {
  title: 'Determinations/LadderStepper',
  component: LadderStepper,
  args: {
    steps: [
      {
        id: 'notice-to-comply',
        label: 'Notice to comply',
        status: 'done',
        detail: 'Issued 3 Aug 2026',
        letter: 'ADM-TSC-2026-0000412-K',
        response: 'Responded 9 Aug 2026',
      },
      {
        id: 'warning',
        label: 'Warning',
        status: 'current',
        detail: 'Issued 20 Aug 2026',
        windowEndsAt: '2026-09-03T09:00:00.000Z',
        letter: 'ADM-TSC-2026-0000519-3',
      },
      { id: 'salary-stoppage', label: 'Salary stoppage', status: 'upcoming' },
      { id: 'disciplinary-referral', label: 'Disciplinary referral', status: 'upcoming' },
    ],
  },
} satisfies Meta<typeof LadderStepper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WarningIssued: Story = {};

export const StoppageAwaitingApproval: Story = {
  args: {
    steps: [
      {
        id: 'notice-to-comply',
        label: 'Notice to comply',
        status: 'done',
        detail: 'Issued 3 Aug 2026',
      },
      { id: 'warning', label: 'Warning', status: 'done', detail: 'Issued 20 Aug 2026' },
      {
        id: 'salary-stoppage',
        label: 'Salary stoppage',
        status: 'awaiting',
        detail: 'Awaiting approval · drafted 4 Sep 2026',
      },
      { id: 'disciplinary-referral', label: 'Disciplinary referral', status: 'upcoming' },
    ],
  },
};

export const SalaryStopped: Story = {
  args: {
    steps: [
      {
        id: 'notice-to-comply',
        label: 'Notice to comply',
        status: 'done',
        detail: 'Issued 3 Aug 2026',
      },
      { id: 'warning', label: 'Warning', status: 'done', detail: 'Issued 20 Aug 2026' },
      {
        id: 'salary-stoppage',
        label: 'Salary stoppage',
        status: 'stopped',
        detail: 'Salary stopped 1 Oct 2026',
        letter: 'ADM-TSC-2026-0000611-8',
      },
      { id: 'disciplinary-referral', label: 'Disciplinary referral', status: 'upcoming' },
    ],
  },
};

export const DeclinedAndComplied: Story = {
  args: {
    steps: [
      {
        id: 'notice-to-comply',
        label: 'Notice to comply',
        status: 'done',
        detail: 'Complied 12 Aug 2026',
      },
      { id: 'warning', label: 'Warning', status: 'declined', detail: 'Declined 2 Sep 2026' },
      { id: 'salary-stoppage', label: 'Salary stoppage', status: 'skipped' },
      { id: 'disciplinary-referral', label: 'Disciplinary referral', status: 'skipped' },
    ],
  },
};

export const Phone: Story = {
  render: (args) => (
    <div className="w-[358px]">
      <LadderStepper {...args} />
    </div>
  ),
};
