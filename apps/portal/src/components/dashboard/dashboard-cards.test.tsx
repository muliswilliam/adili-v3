// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { DeclarantAccount, DeclarantAccountResult } from '../../server/declarant.server';
import type { DeclarationListResult } from '../../server/declarations.server';
import type { Viewer } from '../../server/viewer';
import { DashboardCards } from './dashboard-cards';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
// The start and discard buttons call server functions, which do not load in the VM test pool.
vi.mock('../../server/declarations', async () =>
  (await import('../declaration/testing-mocks')).serverMock(),
);

const account: DeclarantAccount = {
  fullName: 'Mwangi Njoroge Kamau',
  ofr: 'OFR-0000312-7',
  commissions: [
    { slug: 'tsc', name: 'Teachers Service Commission', onboardedAt: '2026-09-26T07:42:00Z' },
  ],
  maskedEmail: 'm***@tsc.go.ke',
  maskedPhone: '07** *** 789',
};

function renderCards(
  declarant: DeclarantAccountResult,
  declarations: Promise<DeclarationListResult> | null = null,
) {
  const viewer: Viewer = {
    user: { name: 'Mwangi Kamau', username: 'OFR-0000312-7', email: 'mwangi.kamau@tsc.go.ke' },
    directory: {
      ok: true,
      principal: { subject: 'u-1', tenant: 'tsc', roles: ['declarant'], clientId: 'portal' },
    },
    declarant,
  } as Viewer;
  render(
    <ToastProvider>
      <DashboardCards
        viewer={viewer}
        declarations={declarations}
        obligations={<section>Your obligations</section>}
      />
    </ToastProvider>,
  );
}

/** The value next to a term in a description list. */
function valueOf(term: string) {
  const dt = screen.getByText(term, { selector: 'dt' });
  const dd = dt.nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`${term} has no value`);
  return dd;
}

describe('DashboardCards', () => {
  it('shows an onboarded declarant their Commission, OFR, masked contacts and onboarded date', () => {
    renderCards({ status: 'onboarded', account });

    expect(screen.getByRole('heading', { name: 'Your account' })).toBeTruthy();
    expect(screen.getByText('Mwangi Njoroge Kamau')).toBeTruthy();
    expect(valueOf('Responsible Commission').textContent).toBe('Teachers Service Commission');
    expect(valueOf('Officer reference').textContent).toContain('OFR-0000312-7');

    const email = valueOf('Email');
    expect(email.textContent).toContain('m***@tsc.go.ke');
    expect(email.textContent).toContain('partially hidden for privacy');
    expect(within(email).getByText('Verified')).toBeTruthy();
    const phone = valueOf('Phone');
    expect(phone.textContent).toContain('07** *** 789');
    expect(within(phone).getByText('Verified')).toBeTruthy();

    expect(screen.getByText('Onboarded on 26 Sep 2026')).toBeTruthy();
    expect(screen.getByText('Your obligations')).toBeTruthy();
  });

  it('copies the OFR and announces it politely', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderCards({ status: 'onboarded', account });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy officer reference' }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('OFR-0000312-7');
    expect(screen.getByRole('status').textContent).toContain('Officer reference copied');
  });

  it('lists every Commission and when the declarant onboarded at each', () => {
    renderCards({
      status: 'onboarded',
      account: {
        ...account,
        commissions: [
          { slug: 'psc', name: 'Public Service Commission', onboardedAt: '2026-03-12T09:15:00Z' },
          ...account.commissions,
        ],
      },
    });

    const commissions = within(valueOf('Responsible Commissions')).getAllByRole('listitem');
    expect(commissions.map((item) => item.textContent)).toEqual([
      'Public Service Commission',
      'Teachers Service Commission',
    ]);
    expect(screen.getByText('Onboarded at Public Service Commission on 12 Mar 2026')).toBeTruthy();
    expect(
      screen.getByText('Onboarded at Teachers Service Commission on 26 Sep 2026'),
    ).toBeTruthy();
  });

  it('says so when a contact is missing', () => {
    renderCards({ status: 'onboarded', account: { ...account, maskedPhone: null } });

    expect(valueOf('Phone').textContent).toBe('Not provided');
  });

  it('shows the sign-in identity for someone not onboarded', () => {
    renderCards({ status: 'not-declarant' });

    expect(screen.getByText('Your account')).toBeTruthy();
    expect(screen.queryByText('You are not onboarded as a declarant')).toBeNull();
    expect(screen.queryByText('Officer reference')).toBeNull();
  });

  it('warns when the account details cannot be loaded, keeping the obligations', () => {
    renderCards({ status: 'unavailable' });

    expect(screen.getByText('Account details unavailable').closest('[role="alert"]')).toBeTruthy();
    expect(screen.getByText('Your obligations')).toBeTruthy();
    expect(screen.queryByText('Officer reference')).toBeNull();
  });

  // The loader does not wait for the declarations: the other cards render while they load.
  it('shows the declarations card loading next to the obligations, then the declarations', async () => {
    let arrive: (result: DeclarationListResult) => void = () => undefined;
    const declarations = new Promise<DeclarationListResult>((done) => {
      arrive = done;
    });
    await act(async () => {
      renderCards({ status: 'onboarded', account }, declarations);
      await Promise.resolve();
    });

    expect(
      screen.getByRole('status', { name: 'Loading your declarations' }).getAttribute('aria-busy'),
    ).toBe('true');
    expect(screen.getByText('Your obligations')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your account' })).toBeTruthy();

    await act(async () => {
      arrive({ status: 'ok', declarations: [] });
      await declarations;
    });

    expect(screen.queryByLabelText('Loading your declarations')).toBeNull();
    expect(screen.getByText('No declarations yet')).toBeTruthy();
  });
});
