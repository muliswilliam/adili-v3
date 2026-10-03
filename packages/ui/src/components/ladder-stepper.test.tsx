import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LadderStepper, type LadderStepperStep } from './ladder-stepper';

const STEPS: LadderStepperStep[] = [
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
  },
  { id: 'salary-stoppage', label: 'Salary stoppage', status: 'upcoming' },
  { id: 'disciplinary-referral', label: 'Disciplinary referral', status: 'upcoming' },
];

const items = () => within(screen.getByRole('list', { name: 'Administrative action ladder' }));

describe('LadderStepper', () => {
  it('lists the steps in order, named as a ladder', () => {
    render(<LadderStepper steps={STEPS} />);

    expect(
      items()
        .getAllByRole('listitem')
        .map((item) => item.querySelector('[data-label]')?.textContent),
    ).toEqual(['Notice to comply', 'Warning', 'Salary stoppage', 'Disciplinary referral']);
  });

  it('marks the step the ladder is on as the current step', () => {
    render(<LadderStepper steps={STEPS} />);

    const [, warning] = items().getAllByRole('listitem');
    expect(warning?.getAttribute('aria-current')).toBe('step');
    expect(
      items()
        .getAllByRole('listitem')
        .filter((item) => item.hasAttribute('aria-current')),
    ).toHaveLength(1);
  });

  it('says each step status in text, not only by the colour of its number', () => {
    render(<LadderStepper steps={STEPS} />);

    const [notice, warning, stoppage] = items().getAllByRole('listitem');
    expect(notice?.textContent).toContain('Status: Done.');
    expect(warning?.textContent).toContain('Status: In progress.');
    // A step with no detail shows its status word as its line, read once.
    expect(stoppage?.textContent).toBe('3Salary stoppageStatus: Not started.');
  });

  it('hides the number circle from screen readers', () => {
    render(<LadderStepper steps={STEPS} />);

    const [, warning] = items().getAllByRole('listitem');
    expect(warning?.querySelector('[data-marker]')?.getAttribute('aria-hidden')).toBe('true');
    expect(warning?.querySelector('[data-marker]')?.textContent).toBe('2');
  });

  it('prints when a step window ends', () => {
    render(<LadderStepper steps={STEPS} />);

    expect(screen.getByText('Act by 3 Sep 2026')).toBeTruthy();
  });

  it('shows the letter a step issued and the declarant response', () => {
    render(<LadderStepper steps={STEPS} />);

    const notice = screen.getByText('Notice to comply').closest('li') ?? document.body;
    expect(within(notice).getByText('ADM-TSC-2026-0000412-K')).toBeTruthy();
    expect(within(notice).getByText('Responded 9 Aug 2026')).toBeTruthy();
  });

  it('shows where a salary stoppage stands with payroll', () => {
    render(
      <LadderStepper
        steps={[
          ...STEPS.slice(0, 2),
          {
            id: 'salary-stoppage',
            label: 'Salary stoppage',
            status: 'stopped',
            payroll: 'Payroll acknowledged 20 Aug 2026',
          },
          ...STEPS.slice(3),
        ]}
      />,
    );

    const [, , stoppage] = items().getAllByRole('listitem');
    if (!stoppage) throw new Error('no stoppage step');
    expect(within(stoppage).getByText('Payroll acknowledged 20 Aug 2026')).toBeTruthy();
    expect(items().getAllByRole('listitem')[0]?.querySelector('[data-payroll]')).toBeNull();
  });

  it('says a step that was not needed, declined or stopped a salary', () => {
    render(
      <LadderStepper
        steps={[
          { id: 'a', label: 'Notice to comply', status: 'done' },
          { id: 'b', label: 'Warning', status: 'declined', detail: '2 Sep 2026' },
          {
            id: 'c',
            label: 'Salary stoppage',
            status: 'stopped',
            detail: 'From 1 Oct 2026',
          },
          { id: 'd', label: 'Disciplinary referral', status: 'skipped' },
          { id: 'e', label: 'Extra', status: 'awaiting', detail: 'Drafted 2 Oct 2026' },
        ]}
      />,
    );

    const [, warning, stoppage, referral, extra] = items().getAllByRole('listitem');
    expect(warning?.textContent).toContain('Status: Declined.');
    expect(stoppage?.textContent).toContain('Status: Salary stopped.');
    expect(referral?.textContent).toContain('Not needed');
    expect(extra?.textContent).toContain('Status: Awaiting approval.');
    expect(warning?.dataset.status).toBe('declined');
  });

  it('marks the step a ladder rests on when none is running', () => {
    const { rerender } = render(
      <LadderStepper
        steps={[
          { id: 'a', label: 'Notice to comply', status: 'done' },
          { id: 'b', label: 'Warning', status: 'done' },
          { id: 'c', label: 'Salary stoppage', status: 'stopped' },
          { id: 'd', label: 'Disciplinary referral', status: 'awaiting' },
        ]}
      />,
    );
    expect(
      items()
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('aria-current')),
    ).toEqual([null, null, null, 'step']);

    rerender(
      <LadderStepper
        currentStepId="c"
        steps={[
          { id: 'c', label: 'Salary stoppage', status: 'stopped' },
          { id: 'd', label: 'Disciplinary referral', status: 'awaiting' },
        ]}
      />,
    );
    expect(items().getAllByRole('listitem')[0]?.getAttribute('aria-current')).toBe('step');
  });

  it('marks no step once the ladder has ended in compliance', () => {
    render(
      <LadderStepper
        steps={[
          { id: 'a', label: 'Notice to comply', status: 'complied', detail: '12 Aug 2026' },
          { id: 'b', label: 'Warning', status: 'skipped' },
        ]}
      />,
    );

    const [notice] = items().getAllByRole('listitem');
    expect(notice?.textContent).toContain('Status: Complied.');
    expect(
      items()
        .getAllByRole('listitem')
        .some((item) => item.hasAttribute('aria-current')),
    ).toBe(false);
  });

  it('says a reinstated salary, and words a step window its own way', () => {
    render(
      <LadderStepper
        steps={[
          {
            id: 'c',
            label: 'Salary stoppage',
            status: 'reinstated',
            detail: '2 Nov 2026',
            windowEndsAt: '2026-10-31T09:00:00.000Z',
            windowLabel: (date) => `Stoppage window ends ${date}`,
          },
        ]}
      />,
    );

    expect(items().getByRole('listitem').textContent).toContain('Status: Salary reinstated.');
    expect(screen.getByText('Stoppage window ends 31 Oct 2026')).toBeTruthy();
  });

  it('takes another name and other wording', () => {
    render(
      <LadderStepper
        label="Hatua za kiutawala"
        steps={[
          {
            id: 'a',
            label: 'Notisi',
            status: 'current',
            detail: 'Imetolewa',
            windowEndsAt: '2026-09-03T09:00:00.000Z',
          },
        ]}
        messages={{
          statusPrefix: 'Hali',
          statuses: { current: 'Inaendelea' },
          windowEndsAt: (date) => `Kabla ya ${date}`,
        }}
      />,
    );

    const list = screen.getByRole('list', { name: 'Hatua za kiutawala' });
    expect(list.textContent).toContain('Hali: Inaendelea.');
    expect(within(list).getByText('Kabla ya 3 Sep 2026')).toBeTruthy();
  });
});
