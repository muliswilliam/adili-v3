// @vitest-environment jsdom
import { DescriptionItem, DescriptionList, ToastProvider } from '@adili/ui';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  isIdentityLocked,
  LockedChip,
  OnboardingStatusItems,
  recordOnboarding,
  type RosterRecordOnboarding,
} from './record-onboarding';

const notOnboarded: RosterRecordOnboarding = {
  state: 'not_onboarded',
  ofr: null,
  onboardedAt: null,
  identityMismatchAt: null,
};

const onboarded: RosterRecordOnboarding = {
  state: 'onboarded',
  ofr: 'OFR-0482913-H',
  onboardedAt: '2026-09-26T07:42:00Z',
  identityMismatchAt: null,
};

const mismatch: RosterRecordOnboarding = {
  ...notOnboarded,
  identityMismatchAt: '2026-09-24T11:20:00Z',
};

/** The record detail's Status list, as #46 lays it out. */
function renderStatus(record: RosterRecordOnboarding) {
  render(
    <ToastProvider>
      <DescriptionList>
        <DescriptionItem term="State">{record.state}</DescriptionItem>
        <OnboardingStatusItems record={record} />
        <DescriptionItem term="Exit date">-</DescriptionItem>
      </DescriptionList>
    </ToastProvider>,
  );
}

function terms() {
  return screen.getAllByRole('term').map((term) => term.textContent);
}

function valueOf(term: string) {
  const dd = screen.getByText(term, { selector: 'dt' }).nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`${term} has no value`);
  return dd;
}

describe('OnboardingStatusItems', () => {
  it('shows the OFR and when the declarant onboarded', () => {
    renderStatus(onboarded);

    expect(terms()).toEqual(['State', 'Officer reference', 'Onboarded on', 'Exit date']);
    expect(valueOf('Officer reference').textContent).toContain('OFR-0482913-H');
    expect(valueOf('Onboarded on').textContent).toBe('26 Sep 2026, 10:42');
  });

  it('copies the OFR and announces it politely', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderStatus(onboarded);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy officer reference' }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('OFR-0482913-H');
    expect(screen.getByRole('status').textContent).toContain('Officer reference copied');
  });

  it('adds nothing for a declarant who has not onboarded', () => {
    renderStatus(notOnboarded);

    expect(terms()).toEqual(['State', 'Exit date']);
  });

  it('shows a failed identity check', () => {
    renderStatus(mismatch);

    expect(terms()).toEqual(['State', 'Identity check', 'Exit date']);
    expect(valueOf('Identity check').textContent).toBe('Identity check failed');
  });

  it('leaves out the OFR of an exited declarant', () => {
    renderStatus({ ...onboarded, state: 'exited' });

    expect(terms()).toEqual(['State', 'Exit date']);
  });
});

describe('locked identity', () => {
  it('locks full name and national ID only once the declarant has onboarded', () => {
    expect(isIdentityLocked(onboarded)).toBe(true);
    expect(isIdentityLocked(notOnboarded)).toBe(false);
    expect(isIdentityLocked({ state: 'exited' })).toBe(false);
  });

  it('explains the lock to pointer and screen reader users', () => {
    render(
      <p>
        Wanjiru Achieng Otieno
        <LockedChip />
      </p>,
    );

    const chip = screen.getByTitle('Locked because the declarant has onboarded');
    expect(chip.textContent).toBe('Locked because the declarant has onboarded');
  });
});

describe('recordOnboarding', () => {
  it('reads the spec 03 fields off a roster record', () => {
    expect(
      recordOnboarding({
        state: 'onboarded',
        ofr: 'OFR-0482913-H',
        onboardedAt: '2026-09-26T07:42:00Z',
        identityMismatchAt: null,
      }),
    ).toEqual(onboarded);
  });

  it('treats fields the directory does not send yet as not set', () => {
    expect(recordOnboarding({ state: 'not_onboarded' })).toEqual(notOnboarded);
  });
});
