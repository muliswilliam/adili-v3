// @vitest-environment jsdom
import { ACCESS_OFFICER } from '@adili/roles';
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_LEA_IDS as L } from '../../../server/access/lea-mock.server';
import {
  mockAccessClient,
  resetAccessMock,
  setAccessMockLatency,
} from '../../../server/access/mock.server';
import type { LeaRequest } from '../../../server/access/types';
import { decideLea, previewLea } from '../../../server/lea-requests';
import {
  decideLeaRequest,
  loadLeaRequest,
  previewLeaScope,
} from '../../../server/lea-requests.server';
import { LeaDecidePage } from './decide-page';

const invalidate = vi.fn(() => Promise.resolve());
const navigate = vi.fn(() => Promise.resolve());

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate }),
  useNavigate: () => navigate,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('../../../server/access-requests', () => ({}));
vi.mock('../../../server/lea-requests', () => ({ decideLea: vi.fn(), previewLea: vi.fn() }));

const client = () => mockAccessClient([ACCESS_OFFICER]);

async function requestOf(id: string): Promise<LeaRequest> {
  const result = await loadLeaRequest(client(), id);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

function renderPage(request: LeaRequest, readOnly = false) {
  render(
    <TooltipProvider>
      <ToastProvider>
        <LeaDecidePage request={request} readOnly={readOnly} />
      </ToastProvider>
    </TooltipProvider>,
  );
}

beforeAll(() => {
  setAccessMockLatency(0);
});
afterAll(() => {
  setAccessMockLatency(1);
});
beforeEach(() => {
  resetAccessMock();
  navigate.mockClear();
  vi.mocked(decideLea).mockImplementation(({ data }) =>
    decideLeaRequest(client(), data.requestId, data.input, data.idempotencyKey),
  );
  vi.mocked(previewLea).mockReset();
  vi.mocked(previewLea).mockImplementation(({ data }) =>
    previewLeaScope(client(), data.requestId, data.scope),
  );
});

describe('deciding a law enforcement request (spec 10 FE-6, S11)', () => {
  it('offers grant and deny once verified, never a partial grant', async () => {
    renderPage(await requestOf(L.verified));
    const outcome = screen.getByRole('radiogroup', { name: 'Outcome' });
    expect(
      within(outcome)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('value')),
    ).toEqual(['grant', 'deny']);
    expect(screen.getByRole('region', { name: 'Request' }).textContent).toContain(
      'Asset Recovery Agency',
    );
  });

  it('S11: grants, confirming the package goes to the officer and the declarant is not told', async () => {
    renderPage(await requestOf(L.verified));
    fireEvent.click(screen.getByRole('radio', { name: 'Grant' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Reasons/ }), {
      target: { value: 'Provisioned ARA account, reason and case reference stated.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record grant?' });
    expect(dialog.textContent).toContain('The declarant is not notified.');
    expect(dialog.textContent).toContain(
      'A Confidential package goes to Mary Achieng Otieno (ARA)',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record decision' }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });
    expect((await requestOf(L.verified)).status).toBe('granted');
  });

  it('decision 1: previews what the requested scope holds once verified, and not before', async () => {
    renderPage(await requestOf(L.verified));
    const counts = await screen.findByRole('region', { name: 'What the requested scope holds' });
    await waitFor(() => {
      expect(counts.textContent).toContain('2 declarations');
    });
    expect(counts.textContent).not.toContain('Clarifications');
  });

  it('offers only a denial before verification, with Regulation 24 grounds', async () => {
    renderPage(await requestOf(L.received));
    expect(screen.getByText(/can only be denied now/)).toBeTruthy();
    const outcome = screen.getByRole('radiogroup', { name: 'Outcome' });
    expect(within(outcome).getAllByRole('radio')).toHaveLength(1);
    fireEvent.click(screen.getByRole('radio', { name: 'Deny' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Reasons/ }), {
      target: { value: 'The officer sought cannot be identified.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByText('Choose at least one ground for a partial grant or a denial.'),
    ).toBeTruthy();
  });

  it('tells the supervisor only the access officer decides', async () => {
    renderPage(await requestOf(L.verified), true);
    expect(screen.getByText('Only the access officer decides')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('says a decided request is final', async () => {
    renderPage(await requestOf(L.denied));
    expect(screen.getByText('Already decided')).toBeTruthy();
  });
});
