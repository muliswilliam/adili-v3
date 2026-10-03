import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PATTERN_KINDS, PatternCard, PatternCardSkeleton } from './pattern-card';

describe('PatternCard', () => {
  it('names the card by its kind and subject, and shows its value and comparison', () => {
    render(
      <PatternCard
        kind="rate-change"
        subject="Nairobi City County Public Service Board"
        value="12.4%"
        valueLabel="non-filer rate"
        comparison="from 6.1% in 2026"
      />,
    );

    const card = screen.getByRole('article', {
      name: 'Rate change: Nairobi City County Public Service Board',
    });
    expect(within(card).getByText('12.4%')).toBeTruthy();
    expect(within(card).getByText('non-filer rate')).toBeTruthy();
    expect(within(card).getByText('from 6.1% in 2026')).toBeTruthy();
  });

  it('labels the kind with an icon and words, and explains it in the title', () => {
    render(<PatternCard kind="threshold-breach" subject="National" value="9.8%" />);

    const badge = screen.getByText('Above threshold');
    expect(badge.getAttribute('title')).toBe('A non-filer rate above the threshold');
    expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('has a label and an explanation for every kind of the contract', () => {
    render(
      <>
        {PATTERN_KINDS.map((kind) => (
          <PatternCard key={kind} kind={kind} subject="National" value="1" />
        ))}
      </>,
    );

    expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual([
      'Rate change: National',
      'Above threshold: National',
      'Repeatedly late: National',
      'High clarifications: National',
      'Size-band outlier: National',
      'Did not report: National',
    ]);
    expect(PATTERN_KINDS).toEqual([
      'rate-change',
      'threshold-breach',
      'chronic-late-reporting',
      'clarification-ratio-outlier',
      'size-band-outlier',
      'non-reporting',
    ]);
  });

  it('cites the pattern in findings, with a button naming which pattern', async () => {
    const onCite = vi.fn();
    render(
      <PatternCard
        kind="chronic-late-reporting"
        subject="Kenya Ports Authority"
        value="3 years"
        onCite={onCite}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Cite in findings: Repeatedly late, Kenya Ports Authority',
      }),
    );

    expect(onCite).toHaveBeenCalledOnce();
    expect(screen.getByRole('button').textContent).toBe('Cite in findings');
  });

  it('says it is cited in findings instead of offering to cite it again', () => {
    render(
      <PatternCard
        kind="non-reporting"
        subject="Kenya Ports Authority"
        value="2 years"
        cited
        onCite={() => undefined}
      />,
    );

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Cited in findings')).toBeTruthy();
    expect(screen.getByRole('article').dataset.cited).toBe('true');
  });

  it('has no action when it can be neither cited nor was cited (read only)', () => {
    render(<PatternCard kind="non-reporting" subject="National" value="2 of 47" />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Cited in findings')).toBeNull();
  });

  it('takes any action in its slot', () => {
    render(
      <PatternCard
        kind="size-band-outlier"
        subject="National"
        value="1"
        onCite={() => undefined}
        action={<a href="#row">Open row</a>}
      />,
    );

    expect(screen.getByRole('link', { name: 'Open row' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('takes other wording', () => {
    render(
      <PatternCard
        kind="rate-change"
        subject="Taifa"
        value="1"
        onCite={() => undefined}
        messages={{
          kinds: { 'rate-change': { label: 'Mabadiliko', description: 'Kiwango kimebadilika' } },
          cite: 'Taja',
          citeName: (kind, subject) => `Taja: ${kind}, ${subject}`,
        }}
      />,
    );

    expect(screen.getByRole('article', { name: 'Mabadiliko: Taifa' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Taja: Mabadiliko, Taifa' }).textContent).toBe(
      'Taja',
    );
  });
});

describe('PatternCardSkeleton', () => {
  it('stands in for a card while candidates load, hidden from screen readers', () => {
    const { container } = render(<PatternCardSkeleton />);

    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });
});
