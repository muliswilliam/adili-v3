import { BankIcon, File01Icon, JusticeScale01Icon } from '@hugeicons/core-free-icons';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApprovalCard, ApprovalConsequences } from './approval-card';
import { Button } from './button';

const NOW = Date.parse('2026-10-03T09:00:00.000Z');

function renderCard(props: Partial<Parameters<typeof ApprovalCard>[0]> = {}) {
  return render(
    <ApprovalCard
      icon={JusticeScale01Icon}
      title="Jane Wanjiru"
      details={['CMP-TSC-2026-0000044-7', 'Teachers Service Commission']}
      proposer="Kevin Omondi"
      proposedAt="2026-10-03T06:00:00.000Z"
      now={NOW}
      summary="All items reconcile with the registries."
      decision={<Button size="sm">Approve</Button>}
      link={<a href="/cases/1">Open case</a>}
      {...props}
    />,
  );
}

describe('ApprovalCard', () => {
  it('is an article named by its title, with the title as a heading', () => {
    renderCard();

    const card = screen.getByRole('article', { name: 'Jane Wanjiru' });
    expect(within(card).getByRole('heading', { name: 'Jane Wanjiru' })).toBeTruthy();
  });

  it('can be named for what it asks to approve', () => {
    renderCard({ 'aria-label': 'Determination for Jane Wanjiru' });

    expect(screen.getByRole('article', { name: 'Determination for Jane Wanjiru' })).toBeTruthy();
  });

  it('shows the subject details and who proposed it', () => {
    renderCard();

    const card = screen.getByRole('article');
    expect(within(card).getByText('CMP-TSC-2026-0000044-7')).toBeTruthy();
    expect(within(card).getByText('Teachers Service Commission')).toBeTruthy();
    expect(card.textContent).toContain('Proposed by Kevin Omondi');
  });

  it('puts a badge beside the title', () => {
    renderCard({ badge: <span>Supervisor only</span> });

    expect(within(screen.getByRole('heading')).getByText('Supervisor only')).toBeTruthy();
  });

  it('says how long the proposal has waited, amber from 7 days and red past 30', () => {
    const { rerender } = renderCard();
    expect(screen.getByText('Today')).toBeTruthy();

    rerender(
      <ApprovalCard icon={File01Icon} title="A" proposedAt="2026-10-02T06:00:00.000Z" now={NOW} />,
    );
    expect(screen.getByText('Waiting 1 day').className).toContain('bg-muted');

    rerender(
      <ApprovalCard icon={File01Icon} title="A" proposedAt="2026-09-26T06:00:00.000Z" now={NOW} />,
    );
    expect(screen.getByText('Waiting 7 days').className).toContain('text-warning');

    rerender(
      <ApprovalCard icon={File01Icon} title="A" proposedAt="2026-09-02T06:00:00.000Z" now={NOW} />,
    );
    expect(screen.getByText('Waiting 31 days').className).toContain('text-destructive');
  });

  it('shows the summary under its label', () => {
    renderCard({ summaryLabel: 'Earlier steps', summary: 'Notice to comply issued 3 Aug 2026' });

    expect(screen.getByText('Earlier steps')).toBeTruthy();
    expect(screen.getByText('Notice to comply issued 3 Aug 2026')).toBeTruthy();
  });

  it('states in text what approving does', () => {
    renderCard({
      consequences: [
        {
          icon: File01Icon,
          title: 'A CMP number is allocated in your name',
          detail: 'Next number: CMP-TSC-2026-0000045-5',
        },
        { icon: BankIcon, title: 'Payroll receives a stop_salary instruction', grave: true },
      ],
    });

    const section = screen.getByRole('region', { name: 'When you approve' });
    const rows = within(section).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'A CMP number is allocated in your nameNext number: CMP-TSC-2026-0000045-5',
      'Payroll receives a stop_salary instruction',
    ]);
    expect(rows[1]?.dataset.grave).toBe('true');
  });

  it('offers the decision when the officer can approve', () => {
    renderCard({ actions: <Button size="sm">Reassign</Button> });

    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reassign' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open case' })).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('says why the officer cannot approve, in place of the decision', () => {
    renderCard({ cannotApproveReason: 'proposer', actions: <Button size="sm">Reassign</Button> });

    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByRole('note').textContent).toBe(
      'You proposed this. Another officer must approve it.',
    );
    expect(screen.getByRole('button', { name: 'Reassign' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open case' })).toBeTruthy();
  });

  it('has words for each reason the contract gives, and takes others', () => {
    const { rerender } = renderCard({ cannotApproveReason: 'reviewer-of-record' });
    expect(screen.getByRole('note').textContent).toBe(
      'You cannot approve this: you reviewed this case.',
    );

    rerender(<ApprovalCard icon={File01Icon} title="A" cannotApproveReason="role" />);
    expect(screen.getByRole('note').textContent).toBe('Only a supervisor can approve this.');

    rerender(
      <ApprovalCard
        icon={File01Icon}
        title="A"
        cannotApproveReason="role"
        cannotApproveText="Only a supervisor can approve a salary stoppage."
      />,
    );
    expect(screen.getByRole('note').textContent).toBe(
      'Only a supervisor can approve a salary stoppage.',
    );
  });
});

describe('ApprovalConsequences', () => {
  it('takes another heading', () => {
    render(
      <ApprovalConsequences
        heading="Ukiidhinisha"
        items={[{ icon: File01Icon, title: 'Barua inatolewa' }]}
      />,
    );

    expect(
      within(screen.getByRole('region', { name: 'Ukiidhinisha' })).getByText('Barua inatolewa'),
    ).toBeTruthy();
  });
});
