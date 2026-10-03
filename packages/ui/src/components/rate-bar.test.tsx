import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RateBar } from './rate-bar';

describe('RateBar', () => {
  it('shows the percentage declared as text, with declared of expected', () => {
    const { container } = render(<RateBar declared={42} expected={50} />);

    expect(screen.getByText('84%')).toBeTruthy();
    expect(screen.getByText('42 of 50')).toBeTruthy();
    expect(container.textContent).toBe('84% declared, 42 of 50');
  });

  it('rounds to one decimal place and groups thousands', () => {
    const { container } = render(<RateBar declared={7_001} expected={9_000} />);

    expect(screen.getByText('77.8%')).toBeTruthy();
    expect(container.textContent).toContain('7,001 of 9,000');
  });

  it('never rounds up to 100% while someone has not declared', () => {
    render(<RateBar declared={9_999} expected={10_000} />);

    expect(screen.getByText('99.9%')).toBeTruthy();
  });

  it('fills the bar to the share declared, never past full', () => {
    const { container, rerender } = render(<RateBar declared={1} expected={4} />);
    const fill = () => container.querySelector<HTMLElement>('[data-slot="rate-fill"]');

    expect(fill()?.style.width).toBe('25%');

    rerender(<RateBar declared={6} expected={4} />);
    expect(screen.getByText('150%')).toBeTruthy();
    expect(fill()?.style.width).toBe('100%');
  });

  it('hides the bar itself from screen readers, which read the text', () => {
    const { container } = render(<RateBar declared={1} expected={4} />);

    expect(container.querySelector('[data-slot="rate-track"]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('can leave out the counts and still reads them to screen readers', () => {
    const { container } = render(<RateBar declared={42} expected={50} showCounts={false} />);

    expect(screen.getByText('42 of 50').className).toContain('sr-only');
    expect(container.textContent).toBe('84% declared, 42 of 50');
  });

  it('is plain at or above the threshold, amber below it and red below the critical rate', () => {
    const tone = (declared: number) => {
      const { container, unmount } = render(<RateBar declared={declared} expected={100} />);
      const value = container.querySelector<HTMLElement>('[data-tone]')?.dataset.tone;
      unmount();
      return value;
    };

    expect(tone(80)).toBe('ok');
    expect(tone(79)).toBe('low');
    expect(tone(60)).toBe('low');
    expect(tone(59)).toBe('critical');
  });

  it('takes the thresholds as shares, as the intake configures them', () => {
    const { container } = render(
      <RateBar declared={85} expected={100} threshold={0.9} criticalBelow={0.5} />,
    );

    expect(container.querySelector<HTMLElement>('[data-tone]')?.dataset.tone).toBe('low');
  });

  it('says none were expected instead of a rate', () => {
    const { container } = render(<RateBar declared={0} expected={0} />);

    expect(container.textContent).toBe('None expected');
    expect(container.querySelector('[data-slot="rate-track"]')).toBeNull();
  });

  it('says how many declared when none were expected', () => {
    const { container } = render(<RateBar declared={3} expected={0} />);

    expect(container.textContent).toBe('3 declared, 0 expected');
  });

  it('takes other wording', () => {
    const { container } = render(
      <RateBar
        declared={1}
        expected={2}
        messages={{ declared: 'wamejaza', counts: (d, e) => `${d} kati ya ${e}` }}
      />,
    );

    expect(container.textContent).toBe('50% wamejaza, 1 kati ya 2');
  });
});
