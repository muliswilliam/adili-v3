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

  it('says a step that was not needed, declined or stopped a salary', () => {
    render(
      <LadderStepper
        steps={[
          { id: 'a', label: 'Notice to comply', status: 'done' },
          { id: 'b', label: 'Warning', status: 'declined', detail: 'Declined 2 Sep 2026' },
          {
            id: 'c',
            label: 'Salary stoppage',
            status: 'stopped',
            detail: 'Salary stopped 1 Oct 2026',
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
