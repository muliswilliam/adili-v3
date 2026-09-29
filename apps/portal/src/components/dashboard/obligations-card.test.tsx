// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { startMyDeclaration } from '../../server/declarations';
import type { Obligation } from '../../server/declarations/types';
import { navigate } from '../declaration/testing-mocks';
import { CLOSED_REASONS } from './obligations';
import { type DashboardWork, ObligationsCard } from './obligations-card';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);
vi.mock('../../server/declarations', async () =>
  (await import('../declaration/testing-mocks')).serverMock(),
);

const startMock = vi.mocked(startMyDeclaration);
const TSC = { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' };

function obligation(
  id: string,
  status: Obligation['status'],
  type: Obligation['type'] = 'biennial',
) {
  return {
    id,
    commission: TSC,
    type,
    cycleKey: 'biennial:2027',
    statementDate: '2027-11-01',
    dueDate: '2027-12-31',
    status,
    cancelReason: null,
    remindersSent: 0,
    policyVersion: 1,
    createdAt: '2026-09-01T06:00:00Z',
  } satisfies Obligation;
}

const DUE = '0b1e5a1d-5c0a-4d3e-9f10-000000000001';
const DRAFTED = '0b1e5a1d-5c0a-4d3e-9f10-000000000002';

function work(obligations: Obligation[], drafts: { id: string; obligationId: string }[] = []) {
  return {
    obligations: { status: 'ok', obligations: { groups: [{ commission: TSC, obligations }] } },
    declarations: {
      status: 'ok',
      declarations: drafts.map((draft) => ({
        ...draft,
        commission: TSC,
        type: 'biennial',
        statementDate: '2027-11-01',
        status: 'draft',
        completenessPercent: 25,
        updatedAt: '2026-09-27T08:00:00Z',
      })),
    },
  } satisfies DashboardWork;
}

function row(title: RegExp) {
  const item = screen.getByRole('heading', { name: title }).closest('li');
  if (!item) throw new Error('no row');
  return within(item);
}

beforeEach(() => {
  startMock.mockReset();
  navigate.mockReset();
});

describe('ObligationsCard (S20)', () => {
  it('keeps the placeholder when there are no obligations', () => {
    render(<ObligationsCard work={null} />);
    expect(screen.getByText('No obligations yet')).toBeTruthy();
  });

  it('enables Start on due and upcoming obligations and explains filed and cancelled ones', () => {
    render(
      <ObligationsCard
        work={work([
          obligation(DUE, 'upcoming'),
          obligation('0b1e5a1d-5c0a-4d3e-9f10-000000000003', 'due', 'initial'),
          obligation('0b1e5a1d-5c0a-4d3e-9f10-000000000004', 'filed', 'final'),
        ])}
      />,
    );

    const upcoming = row(/Biennial declaration/);
    expect(upcoming.getByText('Submit from 1 Nov 2027.')).toBeTruthy();
    expect(
      upcoming.getByRole<HTMLButtonElement>('button', { name: 'Start declaration' }).disabled,
    ).toBe(false);
    expect(
      row(/Initial declaration/).getByRole<HTMLButtonElement>('button', {
        name: 'Start declaration',
      }).disabled,
    ).toBe(false);

    const filed = row(/Final declaration/).getByRole<HTMLButtonElement>('button', {
      name: 'Start declaration',
    });
    expect(filed.disabled).toBe(true);
    const reason = document.getElementById(filed.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toBe(CLOSED_REASONS.filed);
  });

  it('continues an existing draft', () => {
    render(
      <ObligationsCard
        work={work([obligation(DRAFTED, 'due')], [{ id: 'd-1', obligationId: DRAFTED }])}
      />,
    );

    expect(screen.getByText('Draft in progress')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Continue declaration' }).getAttribute('href')).toBe(
      '/declarations/d-1',
    );
  });

  it('starts a declaration and opens its overview', async () => {
    startMock.mockResolvedValue({
      status: 'started',
      created: true,
      declaration: { id: 'd-9' } as never,
    });
    render(<ObligationsCard work={work([obligation(DUE, 'due')])} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start declaration' }));
      await Promise.resolve();
    });

    expect(startMock).toHaveBeenCalledWith({ data: { obligationId: DUE } });
    expect(navigate).toHaveBeenCalledWith({
      to: '/declarations/$id',
      params: { id: 'd-9' },
      search: { started: true },
    });
  });

  it('says so when the obligation closed in the meantime', async () => {
    startMock.mockResolvedValue({ status: 'not-open' });
    render(<ObligationsCard work={work([obligation(DUE, 'due')])} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start declaration' }));
      await Promise.resolve();
    });

    expect(
      screen.getByText('This obligation is no longer open, so a declaration cannot be started.'),
    ).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });
});
