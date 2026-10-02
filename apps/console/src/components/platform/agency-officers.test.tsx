// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LeaOfficerAccount } from '../../server/directory/client';
import { provisionLeaOfficer, revokeLeaOfficer } from '../../server/lea-accounts';
import type { AgencyOfficers } from '../../server/lea-accounts.server';
import { AgenciesTable } from './agencies-table';
import { AgencyOfficersPage } from './agency-officers';
import { filterOfficers } from './officers';
import { provisionFailure } from './provision-form';

const invalidate = vi.fn(() => Promise.resolve());
const navigate = vi.fn(() => Promise.resolve());

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate }),
  useNavigate: () => navigate,
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [name, value]) => path.replace(`$${name}`, value),
        to,
      )}
      {...props}
    >
      {children}
    </a>
  ),
}));
vi.mock('../../server/lea-accounts', () => ({
  provisionLeaOfficer: vi.fn(),
  revokeLeaOfficer: vi.fn(),
}));

const DCI = {
  code: 'DCI',
  name: 'Directorate of Criminal Investigations',
  legalBasis: 'National Police Service Act, 2011, s.35',
};
const ARA = { code: 'ARA', name: 'Asset Recovery Agency', legalBasis: 'POCAMLA, s.53' };

function officer(
  name: string,
  state: LeaOfficerAccount['state'],
  email = `${name.split(' ').at(-1)?.toLowerCase() ?? 'x'}@dci.go.ke`,
): LeaOfficerAccount {
  return {
    id: crypto.randomUUID(),
    agencyCode: 'DCI',
    name,
    email,
    phone: '+254712345678',
    state,
    invitedAt: '2026-09-01T07:00:00.000Z',
    activatedAt: state === 'invited' ? null : '2026-09-02T07:00:00.000Z',
    revokedAt: state === 'revoked' ? '2026-09-20T07:00:00.000Z' : null,
  };
}

const OFFICERS = [
  officer('Insp. Peter Kariuki', 'activated'),
  officer('Sgt. Mary Wanjiru', 'invited'),
  officer('Cpl. Eric Mbugua', 'revoked'),
];

function renderPage(data: Partial<AgencyOfficers> = {}) {
  render(
    <TooltipProvider>
      <ToastProvider>
        <AgencyOfficersPage
          data={{ agency: DCI, officers: OFFICERS, agencies: [DCI, ARA], ...data }}
        />
      </ToastProvider>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  invalidate.mockClear();
  navigate.mockClear();
  vi.mocked(provisionLeaOfficer).mockReset();
  vi.mocked(revokeLeaOfficer).mockReset();
});

describe('law-enforcement accounts (spec 10 FE-6, S11)', () => {
  it('lists the agencies with their legal basis and officer counts', () => {
    render(
      <AgenciesTable
        agencies={[
          { ...DCI, counts: { activated: 3, invited: 1, revoked: 2 } },
          { ...ARA, counts: null },
        ]}
      />,
    );
    const rows = within(screen.getByRole('table', { name: 'Law enforcement agencies' }))
      .getAllByRole('row')
      .slice(1);
    expect(rows[0]?.textContent).toBe(
      'DCIDirectorate of Criminal InvestigationsNational Police Service Act, 2011, s.35312',
    );
    expect(
      within(rows[0] ?? document.body)
        .getByRole('link')
        .getAttribute('href'),
    ).toBe('/platform/law-enforcement/DCI');
    expect(rows[1]?.textContent).toContain('---');
  });

  it("lists an agency's officers, filtered by state and searched by name or email", () => {
    renderPage();
    const chips = screen.getByRole('group', { name: 'Show' });
    expect(chips.textContent).toBe(
      'All 3 officersActive 1 officersInvited 1 officersRevoked 1 officers',
    );
    fireEvent.click(within(chips).getByRole('button', { name: /Revoked/ }));
    const table = screen.getByRole('table', { name: 'DCI officers, by name' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(table.textContent).toContain('Cpl. Eric Mbugua');
    // A revoked officer cannot be revoked again.
    expect(within(table).queryByRole('button', { name: /Revoke/ })).toBeNull();
    expect(filterOfficers(OFFICERS, 'all', 'WANJIRU').map((each) => each.name)).toEqual([
      'Sgt. Mary Wanjiru',
    ]);
  });

  it('invites the first officer of an agency with none', () => {
    renderPage({ officers: [] });
    expect(screen.getByText('No officers yet')).toBeTruthy();
    expect(screen.getByText('Provision the first DCI officer.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Provision officer' })).toBeTruthy();
  });

  it('S11: provisions an officer: checked first, then one activation email', async () => {
    vi.mocked(provisionLeaOfficer).mockResolvedValue({
      ok: true,
      data: officer('Insp. Jane Mwangi', 'invited'),
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Provision officer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Provision officer' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send activation' }));
    expect(dialog.textContent).toContain("Enter the officer's full name.");
    expect(provisionLeaOfficer).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Full name' }), {
      target: { value: 'Insp. Jane Mwangi' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Official email/ }), {
      target: { value: 'J.Mwangi@dci.go.ke' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Phone/ }), {
      target: { value: '0712 345 678' },
    });
    expect(dialog.textContent).toContain('Saved as +254 712 345 678');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send activation' }));
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    expect(provisionLeaOfficer).toHaveBeenCalledWith({
      data: {
        code: 'DCI',
        idempotencyKey: expect.any(String) as unknown,
        officer: { name: 'Insp. Jane Mwangi', email: 'j.mwangi@dci.go.ke', phone: '+254712345678' },
      },
    });
  });

  it("shows an email of another tenant's account at the email", async () => {
    vi.mocked(provisionLeaOfficer).mockResolvedValue({
      ok: false,
      error: {
        kind: 'problem',
        problem: {
          type: 'email-belongs-to-other-tenant',
          title: 'Conflict',
          status: 409,
          errors: [{ path: 'email', message: 'taken' }],
        },
      },
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Provision officer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Provision officer' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Full name' }), {
      target: { value: 'Insp. Grace Muthoni' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Official email/ }), {
      target: { value: 'grace.muthoni@publicservice.go.ke' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Phone/ }), {
      target: { value: '+254 722 118 440' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send activation' }));
    expect(
      await within(dialog).findByText(
        "This email belongs to an account in another tenant. Use the officer's agency email.",
      ),
    ).toBeTruthy();
  });

  it('S11: revokes with a confirmation of what it does', async () => {
    vi.mocked(revokeLeaOfficer).mockResolvedValue({
      ok: true,
      data: { ...OFFICERS[0], state: 'revoked' } as LeaOfficerAccount,
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke Insp. Peter Kariuki' }));
    const dialog = await screen.findByRole('dialog', { name: 'Revoke Insp. Peter Kariuki?' });
    expect(dialog.textContent).toContain('They can no longer sign in');
    expect(dialog.textContent).toContain('Their requests stay on record');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke access' }));
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    expect(revokeLeaOfficer).toHaveBeenCalledWith({ data: { officerId: OFFICERS[0]?.id } });
  });

  it('maps every provisioning refusal', () => {
    const problem = (type: string, status: number) =>
      provisionFailure({ kind: 'problem', problem: { type, title: 't', status } });
    expect(problem('lea-officer-of-other-agency', 409).fieldErrors.email).toMatch(/another agency/);
    expect(problem('lea-officer-busy', 409).alert).toBe('busy');
    expect(problem('idempotency-key-in-use', 409)).toMatchObject({
      alert: 'in-progress',
      newKey: false,
    });
    expect(
      provisionFailure({ kind: 'unavailable', detail: null, problemType: 'invitation-not-sent' }),
    ).toMatchObject({ alert: 'not-sent', newKey: false });
    expect(provisionFailure({ kind: 'unavailable', detail: null }).alert).toBe('error');
  });
});
