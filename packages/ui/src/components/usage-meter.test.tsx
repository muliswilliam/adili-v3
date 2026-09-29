import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatTokenCount, UsageMeter, usageLevel, usagePercent } from './usage-meter';

describe('formatTokenCount', () => {
  it('shortens thousands and millions', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(950)).toBe('950');
    expect(formatTokenCount(412_800)).toBe('413k');
    expect(formatTokenCount(1_000_000)).toBe('1M');
    expect(formatTokenCount(1_500_000)).toBe('1.5M');
    expect(formatTokenCount(1_926_400)).toBe('1.93M');
  });
});

describe('usagePercent and usageLevel', () => {
  it('is normal below 80%, high from 80% and used up at the budget', () => {
    expect(usagePercent(1_926_400, 3_000_000)).toBeCloseTo(64.21, 2);
    expect(usageLevel(1_926_400, 3_000_000)).toBe('normal');
    expect(usageLevel(800_000, 1_000_000)).toBe('high');
    expect(usageLevel(1_500_000, 1_500_000)).toBe('used-up');
    expect(usageLevel(1_600_000, 1_500_000)).toBe('used-up');
    expect(usageLevel(0, 1_000_000)).toBe('normal');
  });

  it('treats any use of a zero budget as used up', () => {
    expect(usagePercent(0, 0)).toBe(0);
    expect(usageLevel(0, 0)).toBe('normal');
    expect(usagePercent(10, 0)).toBe(100);
    expect(usageLevel(10, 0)).toBe('used-up');
  });
});

describe('UsageMeter', () => {
  it('shows tokens used against the budget, and the percentage', () => {
    render(<UsageMeter tokensUsed={1_926_400} monthlyTokens={3_000_000} />);

    const meter = screen.getByRole('meter', { name: 'Tokens this month: 1,926,400 of 3,000,000' });
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('3000000');
    expect(meter.getAttribute('aria-valuenow')).toBe('1926400');
    expect(meter.getAttribute('aria-valuetext')).toBe('64%');
    expect(meter.getAttribute('data-level')).toBe('normal');
    expect(meter.textContent).toBe('1.93M of 3M tokens64%');
  });

  it('warns in text from 80%', () => {
    render(<UsageMeter tokensUsed={862_300} monthlyTokens={1_000_000} />);

    const meter = screen.getByRole('meter', {
      name: 'Tokens this month: 862,300 of 1,000,000. Over 80%',
    });
    expect(meter.getAttribute('data-level')).toBe('high');
    expect(meter.textContent).toContain('86%');
  });

  it('says when the budget is used up, holding the value at the budget', () => {
    render(<UsageMeter tokensUsed={1_600_000} monthlyTokens={1_500_000} />);

    const meter = screen.getByRole('meter', {
      name: 'Tokens this month: 1,600,000 of 1,500,000. Budget used up',
    });
    expect(meter.getAttribute('aria-valuenow')).toBe('1500000');
    expect(meter.getAttribute('aria-valuetext')).toBe('Used up');
    expect(meter.textContent).toContain('Used up');
  });

  it('shows nothing used', () => {
    render(<UsageMeter tokensUsed={0} monthlyTokens={1_000_000} />);

    expect(screen.getByRole('meter').textContent).toBe('0 of 1M tokens0%');
  });

  it('takes other copy', () => {
    render(
      <UsageMeter
        tokensUsed={1_500_000}
        monthlyTokens={1_500_000}
        messages={{
          ofBudget: (budget) => `kati ya ${budget}`,
          usedUp: 'Imekwisha',
          label: (used, budget) => `Tokeni mwezi huu: ${used} kati ya ${budget}`,
          usedUpNote: 'Bajeti imekwisha',
        }}
      />,
    );

    expect(
      screen.getByRole('meter', {
        name: 'Tokeni mwezi huu: 1,500,000 kati ya 1,500,000. Bajeti imekwisha',
      }).textContent,
    ).toBe('1.5M kati ya 1.5MImekwisha');
  });
});
