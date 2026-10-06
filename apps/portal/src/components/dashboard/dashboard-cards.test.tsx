// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { MyClarificationsLoad } from '../../server/clarifications';
import type { DeclarantAccount, DeclarantAccountResult } from '../../server/declarant.server';
import type { DeclarationListResult } from '../../server/declarations.server';
import { mockClarification, MOCK_CLARIFICATION_IDS } from '../../server/review/mock.server';
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
const setMyPreferredLanguage = vi.hoisted(() => vi.fn());
vi.mock('../../server/preferences', () => ({ setMyPreferredLanguage }));
const signInAgain = vi.hoisted(() => vi.fn());
vi.mock('../sign-in', () => ({ signInAgain }));
// jsdom does not lay out, so it has no scrollIntoView, which the language list calls.
Element.prototype.scrollIntoView = vi.fn();

const account: DeclarantAccount = {
  fullName: 'Mwangi Njoroge Kamau',
  ofr: 'OFR-0000312-7',
  commissions: [
    { slug: 'tsc', name: 'Teachers Service Commission', onboardedAt: '2026-09-26T07:42:00Z' },
  ],
  maskedEmail: 'm***@tsc.go.ke',
  maskedPhone: '07** *** 789',
  preferredLanguage: null,
};

function renderCards(
  declarant: DeclarantAccountResult,
  declarations: Promise<DeclarationListResult> | null = null,
  clarifications: Promise<MyClarificationsLoad> | null = null,
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
        clarifications={clarifications}
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

  it('lets the declarant choose the language letters to them start in, English until they do (spec 07c FE-3)', async () => {
    setMyPreferredLanguage.mockResolvedValueOnce({ status: 'saved', preferredLanguage: 'sw' });
    renderCards({ status: 'onboarded', account });

    const language = within(valueOf('Letter language')).getByRole('combobox', {
      name: 'Language of letters to you',
    });
    expect(language.textContent).toContain('English');

    fireEvent.keyDown(language, { key: 'Enter' });
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'Kiswahili' }));
    });

    expect(setMyPreferredLanguage).toHaveBeenCalledWith({ data: { language: 'sw' } });
    expect(language.textContent).toContain('Kiswahili');
    expect(screen.getByRole('status').textContent).toContain(
      'Letters from your Commission will start in Kiswahili',
    );
  });

  it('goes back to the language saved when the choice cannot be saved', async () => {
    setMyPreferredLanguage.mockResolvedValueOnce({ status: 'unavailable' });
    renderCards({ status: 'onboarded', account: { ...account, preferredLanguage: 'sw' } });

    const language = within(valueOf('Letter language')).getByRole('combobox');
    expect(language.textContent).toContain('Kiswahili');
    fireEvent.keyDown(language, { key: 'Enter' });
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'English' }));
    });

    expect(language.textContent).toContain('Kiswahili');
    expect(screen.getByRole('alert').textContent).toContain('could not be saved');
  });

  it('signs the declarant in again when their session ended before the language was saved', async () => {
    setMyPreferredLanguage.mockResolvedValueOnce({ status: 'unauthenticated' });
    renderCards({ status: 'onboarded', account });

    const language = within(valueOf('Letter language')).getByRole('combobox');
    fireEvent.keyDown(language, { key: 'Enter' });
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'Kiswahili' }));
    });

    expect(signInAgain).toHaveBeenCalledOnce();
    expect(language.textContent).toContain('English');
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

  describe('Clarifications card', () => {
    const NOW = '2026-09-28T09:00:00.000Z';
    const noDeclarations = Promise.resolve<DeclarationListResult>({
      status: 'ok',
      declarations: [],
    });

    async function renderWith(load: MyClarificationsLoad) {
      const clarifications = Promise.resolve(load);
      await act(async () => {
        renderCards({ status: 'onboarded', account }, noDeclarations, clarifications);
        await clarifications;
      });
    }

    it('lists the clarifications that need a response, with View all', async () => {
      const open = mockClarification(MOCK_CLARIFICATION_IDS.open);
      const resolved = mockClarification(MOCK_CLARIFICATION_IDS.resolved);
      if (!open || !resolved) throw new Error('fixtures');
      await renderWith({ status: 'ok', clarifications: [open, resolved], now: NOW });

      const card = screen.getByRole('region', { name: 'Clarifications' });
      expect(within(card).getByRole('link', { name: 'View all clarifications' })).toBeTruthy();
      expect(within(card).getByText('2 points on your initial declaration')).toBeTruthy();
      expect(within(card).queryByText('Resolved')).toBeNull();
    });

    it('is not there when there are none', async () => {
      await renderWith({ status: 'ok', clarifications: [], now: NOW });
      expect(screen.queryByRole('region', { name: 'Clarifications' })).toBeNull();
      expect(screen.getByText('No declarations yet')).toBeTruthy();
    });

    it('is not there when the list could not load', async () => {
      await renderWith({ status: 'unavailable', now: NOW });
      expect(screen.queryByRole('region', { name: 'Clarifications' })).toBeNull();
      expect(screen.getByText('Your obligations')).toBeTruthy();
    });
  });
});
