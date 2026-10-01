import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { hasCountdown, ObligationCountdown, StatementDateTerm } from './obligation-dates';

const NOW = Date.parse('2027-10-20T09:00:00+03:00');

describe('ObligationCountdown', () => {
  it('says when an upcoming obligation opens', () => {
    const { container } = render(
      <ObligationCountdown
        obligation={{ status: 'upcoming', statementDate: '2027-11-01', dueDate: '2027-12-31' }}
        now={NOW}
      />,
    );
    expect(container.textContent).toBe('Opens 1 November 2027');
  });

  it('counts a due or overdue obligation down to its due date', () => {
    const due = render(
      <ObligationCountdown
        obligation={{ status: 'due', statementDate: '2027-10-01', dueDate: '2027-10-31' }}
        now={NOW}
      />,
    );
    const overdue = render(
      <ObligationCountdown
        obligation={{ status: 'overdue', statementDate: '2027-09-01', dueDate: '2027-10-01' }}
        now={NOW}
      />,
    );
    expect(due.container.textContent).toContain('Due in 11 days');
    expect(overdue.container.textContent).toContain('19 days overdue');
  });

  it('shows nothing for a filed or cancelled obligation', () => {
    for (const status of ['filed', 'cancelled'] as const) {
      const { container } = render(
        <ObligationCountdown
          obligation={{ status, statementDate: '2027-10-01', dueDate: '2027-10-31' }}
          now={NOW}
        />,
      );
      expect(container.textContent).toBe('');
      expect(hasCountdown(status)).toBe(false);
    }
    expect(hasCountdown('due')).toBe(true);
  });
});

describe('StatementDateTerm', () => {
  it('is focusable and gives its meaning in a tooltip', async () => {
    render(
      <StatementDateTerm hint="The date the position is declared as at.">
        Statement date
      </StatementDateTerm>,
    );
    const term = screen.getByText('Statement date');

    expect(term.getAttribute('tabindex')).toBe('0');
    fireEvent.focus(term);
    expect(
      (await screen.findAllByText('The date the position is declared as at.')).length,
    ).toBeGreaterThan(0);
  });
});
