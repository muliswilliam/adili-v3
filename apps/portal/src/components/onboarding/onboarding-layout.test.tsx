// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { commissionNameFrom, HelpLine, OnboardingStepper } from './onboarding-layout';

const TSC = { slug: 'tsc', name: 'Teachers Service Commission' };

describe('HelpLine', () => {
  it("names the Commission's reporting officer when the Commission is known", () => {
    render(<HelpLine commissionName="Teachers Service Commission" />);

    expect(
      screen.getByText("Need help? Contact Teachers Service Commission's reporting officer."),
    ).toBeDefined();
  });

  it('falls back to fixed text', () => {
    render(<HelpLine commissionName={null} />);

    expect(
      screen.getByText("Need help? Contact your Commission's reporting officer."),
    ).toBeDefined();
  });
});

describe('commissionNameFrom', () => {
  it("reads the session's Commission on a step", () => {
    expect(commissionNameFrom({ status: 'active', session: { commission: TSC } })).toBe(TSC.name);
  });

  it('reads the Commission being identified against', () => {
    expect(commissionNameFrom({ commission: TSC })).toBe(TSC.name);
  });

  it('reads the Commission chosen on step 1 from the list', () => {
    expect(commissionNameFrom({ commissions: [TSC] }, 'tsc')).toBe(TSC.name);
    expect(commissionNameFrom({ commissions: [TSC] })).toBeNull();
  });

  it('is null when nothing says', () => {
    expect(commissionNameFrom(undefined)).toBeNull();
    expect(commissionNameFrom({ status: 'unavailable' })).toBeNull();
    expect(commissionNameFrom({ commission: null })).toBeNull();
  });
});

describe('OnboardingStepper', () => {
  const states = (container: HTMLElement) =>
    [...container.querySelectorAll('[aria-hidden="true"] > span')].map((segment) =>
      segment.getAttribute('data-state'),
    );

  it('inks the steps done and half-inks the current one', () => {
    const { container } = render(<OnboardingStepper step={3} />);

    expect(states(container)).toEqual(['done', 'done', 'current', null, null, null]);
    expect(screen.getByText(/^Step 3 of 6/)).toBeDefined();
  });

  it('reads full on the last step, the page the flow ends on', () => {
    const { container } = render(<OnboardingStepper step={6} />);

    expect(states(container)).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
    expect(screen.getByText(/^Step 6 of 6/)).toBeDefined();
  });

  it("reads full on an applicant's last step too", () => {
    const { container } = render(<OnboardingStepper step={2} names={['One', 'Two']} />);

    expect(states(container)).toEqual(['done', 'done']);
  });
});
