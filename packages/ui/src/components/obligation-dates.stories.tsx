import type { Meta, StoryObj } from '@storybook/react-vite';

import { hasCountdown, ObligationCountdown, StatementDateTerm } from './obligation-dates';

// 26 Sep 2026, 15:00 in Nairobi, so the stories read the same on any day.
const now = Date.parse('2026-09-26T12:00:00Z');

const meta = {
  title: 'Obligations/ObligationCountdown',
  component: ObligationCountdown,
  args: {
    obligation: { status: 'due', statementDate: '2026-09-01', dueDate: '2026-10-08' },
    now,
  },
} satisfies Meta<typeof ObligationCountdown>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens on its statement date. */
export const Upcoming: Story = {
  args: { obligation: { status: 'upcoming', statementDate: '2027-11-01', dueDate: '2027-12-31' } },
};

export const Due: Story = {};

export const Overdue: Story = {
  args: { obligation: { status: 'overdue', statementDate: '2026-08-01', dueDate: '2026-09-23' } },
};

/**
 * Nothing for a filed obligation: its due date no longer counts, and `hasCountdown` tells the
 * caller to leave out the separator around it.
 */
export const Filed: Story = {
  args: { obligation: { status: 'filed', statementDate: '2026-08-01', dueDate: '2026-09-23' } },
  render: (args) => (
    <p className="text-sm">
      Filed
      {hasCountdown(args.obligation.status) ? (
        <>
          {' · '}
          <ObligationCountdown {...args} />
        </>
      ) : null}
    </p>
  ),
};

/** The term with its meaning in a tooltip; focus or hover it. */
export const StatementDate: Story = {
  render: () => (
    <p className="text-sm text-secondary-foreground">
      <StatementDateTerm hint="The date your financial position is declared as at.">
        Statement date
      </StatementDateTerm>{' '}
      1 November 2027
    </p>
  ),
};
