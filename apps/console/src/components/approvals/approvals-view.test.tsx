// @vitest-environment jsdom
import { SUPERVISOR } from '@adili/roles';
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { type ReactNode, useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalsLoad } from '../../server/approvals';
import { loadApprovals } from '../../server/approvals.server';
import {
  MOCK_CASE_IDS,
  MOCK_DETERMINATION_IDS as D,
  MOCK_OFFICERS,
  mockReviewClient,
  resetReviewMock,
} from '../../server/review/mock.server';
import type { Assignee } from '../../server/review/types';
import { approveCaseDetermination } from '../../server/determinations';
import { getSupervisors, reassignToSupervisor } from '../../server/approvals';
import { ApprovalsView } from './approvals-view';

const ME: Assignee = { subject: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Faith Achieng' };
const NOW_MS = Date.parse('2026-10-02T09:00:00Z');

const harness = { reload: () => Promise.resolve() };
const invalidate = vi.fn(() => harness.reload());

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    search?: unknown;
    children: ReactNode;
  }) => {
    let href = to;
    for (const [name, value] of Object.entries(params ?? {}))
      href = href.replace(`$${name}`, value);
    if (search && typeof search === 'object' && 'kind' in search)
      href += `?kind=${String(search.kind)}`;
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
  useRouter: () => ({ invalidate }),
}));

const client = () => mockReviewClient(ME.subject, ME.name, [SUPERVISOR]);

vi.mock('../../server/determinations', async () => {
  const server = await import('../../server/determinations.server');
  interface Data<T> {
    data: T;
  }
  return {
    approveCaseDetermination: vi.fn(
      ({ data }: Data<{ determinationId: string; idempotencyKey: string }>) =>
        server.approveDetermination(client(), data.determinationId, data.idempotencyKey),
    ),
    returnCaseDetermination: vi.fn(({ data }: Data<{ determinationId: string; reason: string }>) =>
      server.returnDetermination(client(), data.determinationId, data.reason),
    ),
  };
});
// The referrals tab is tested in referral-approval.test.tsx.
vi.mock('../../server/referrals', () => ({
  approveCaseReferral: vi.fn(),
  declineCaseReferral: vi.fn(),
}));
vi.mock('../../server/approvals', async () => {
  const server = await import('../../server/approvals.server');
  interface Data<T> {
    data: T;
  }
  return {
    getSupervisors: vi.fn(() => server.loadSupervisors(client(), 'tsc', ME.subject)),
    reassignToSupervisor: vi.fn(
      ({ data }: Data<{ kind: 'determination'; subjectId: string; toSupervisor: string }>) =>
        server.reassignApproval(client(), data.kind, data.subjectId, data.toSupervisor),
    ),
  };
});

async function inbox(): Promise<ApprovalsLoad> {
  return {
    ...(await loadApprovals(client(), 'tsc', { kind: 'determination' })),
    now: new Date(NOW_MS).toISOString(),
  };
}

function Harness({ initial }: { initial: ApprovalsLoad }) {
  const [load, setLoad] = useState(initial);
  useEffect(() => {
    harness.reload = async () => {
      const next = await inbox();
      act(() => {
        setLoad(next);
      });
    };
  }, []);
  return <ApprovalsView kind="determination" load={load} viewer={ME} slug="tsc" paging={null} />;
}

async function open() {
  render(
    <ToastProvider>
      <TooltipProvider>
        <Harness initial={await inbox()} />
      </TooltipProvider>
    </ToastProvider>,
  );
}

/** The approval card of a declarant: the article its heading names. */
function card(name: string): HTMLElement {
  const article = screen.getByRole('heading', { name: new RegExp(name) }).closest('article');
  if (!article) throw new Error(`No card for ${name}`);
  return article;
}

beforeEach(() => {
  resetReviewMock(NOW_MS);
  invalidate.mockClear();
});

describe('ApprovalsView (spec 08 FE-3, S14)', () => {
  it('lists the proposals with counts by kind and age, oldest first', async () => {
    await open();
    expect(screen.getByText('9 awaiting approval')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Determinations\s*4/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Referrals\s*5/ })).toBeTruthy();
    const bands = screen.getByLabelText('Waiting');
    expect(bands.textContent).toBe('WaitingUnder 7 days47 to 30 days4Over 30 days1');
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(within(card('Ruth Nekesa Wafula')).getByText('Reassigned to you')).toBeTruthy();
    expect(within(card('Ruth Nekesa Wafula')).getByText('Waiting 35 days')).toBeTruthy();
  });

  it('says why the viewer cannot approve, and offers Reassign instead', async () => {
    await open();
    const blocked = card('Esther Moraa Onyango');
    expect(
      within(blocked).getByText('You cannot approve this: you reviewed this case.'),
    ).toBeTruthy();
    expect(within(blocked).queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.click(
      within(blocked).getByRole('button', { name: 'Reassign to another supervisor' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Reassign to another supervisor' });
    fireEvent.click(await within(dialog).findByRole('radio', { name: 'Lucy Wambui' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reassign' }));
    await vi.waitFor(() => {
      expect(
        within(card('Esther Moraa Onyango')).getByText('Reassigned to Lucy Wambui'),
      ).toBeTruthy();
    });
  });

  it('states the consequences before approving, then approves (S1)', async () => {
    await open();
    fireEvent.click(within(card('Mary Achieng')).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve determination' });
    expect(within(dialog).getByText('A CMP number is allocated in your name')).toBeTruthy();
    expect(within(dialog).getByText('The decision letter is issued')).toBeTruthy();
    expect(within(dialog).getByText('Mary Achieng is notified')).toBeTruthy();
    expect(within(dialog).getByText('The case is closed as determined')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve determination' }));
    expect(
      await screen.findByText(/^Approved\. CMP-TSC-\d{4}-\d{7}-[A-Z0-9] allocated\.$/),
    ).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Determination: Mary Achieng' })).toBeNull();
  });

  it('says the further action keeps the case open', async () => {
    await open();
    fireEvent.click(within(card('Kennedy Kiprop Rono')).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve determination' });
    expect(within(dialog).getByText('The case stays open for the further action')).toBeTruthy();
  });

  it('requires a reason to return a proposal (S2)', async () => {
    await open();
    fireEvent.click(within(card('Mary Achieng')).getByRole('button', { name: 'Return' }));
    const dialog = await screen.findByRole('dialog', { name: 'Return to the reviewer' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Return proposal' }));
    expect(within(dialog).getByText('Enter a reason.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Reason'), {
      target: { value: 'Say how the HR letter explains the late filing.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Return proposal' }));
    expect(await screen.findByText('Returned to the reviewer')).toBeTruthy();
  });

  it('says a refused return cannot be returned, not approved (403)', async () => {
    await open();
    const { reassign } = await import('../../server/review-case.server');
    fireEvent.click(within(card('Mary Achieng')).getByRole('button', { name: 'Return' }));
    const dialog = await screen.findByRole('dialog', { name: 'Return to the reviewer' });
    await reassign(client(), MOCK_CASE_IDS.peters, ME.subject);
    fireEvent.change(within(dialog).getByLabelText('Reason'), {
      target: { value: 'Say how the HR letter explains the late filing.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Return proposal' }));
    const notice = await screen.findByRole('dialog', { name: 'You cannot return this' });
    expect(
      within(notice).getByText('You cannot return this: you reviewed this case.'),
    ).toBeTruthy();
  });

  it('explains a separation-of-duties refusal and offers Reassign (403)', async () => {
    await open();
    // The viewer is handed the case after the inbox loaded: now a reviewer of record.
    const { reassign } = await import('../../server/review-case.server');
    await reassign(client(), MOCK_CASE_IDS.peters, ME.subject);
    fireEvent.click(within(card('Mary Achieng')).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve determination' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve determination' }));
    const notice = await screen.findByRole('dialog', { name: 'You cannot approve this' });
    expect(
      within(notice).getByText('You cannot approve this: you reviewed this case.'),
    ).toBeTruthy();
    expect(within(notice).getByText('403 separation-of-duties')).toBeTruthy();
    fireEvent.click(within(notice).getByRole('button', { name: 'Reassign to another supervisor' }));
    expect(
      await screen.findByRole('dialog', { name: 'Reassign to another supervisor' }),
    ).toBeTruthy();
  });

  it('says so when someone else decided first (409 not-proposed)', async () => {
    await open();
    const { approveDetermination } = await import('../../server/determinations.server');
    await approveDetermination(
      mockReviewClient(MOCK_OFFICERS.lucy.subject, MOCK_OFFICERS.lucy.name, [SUPERVISOR]),
      D.peters,
      crypto.randomUUID(),
    );
    fireEvent.click(within(card('Mary Achieng')).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve determination' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve determination' }));
    const notice = await screen.findByRole('dialog', { name: 'Already decided' });
    expect(within(notice).getByText('409 not-proposed')).toBeTruthy();
  });

  it('shows the empty and failed states', () => {
    const now = new Date(NOW_MS).toISOString();
    const counts = {
      byKind: { determination: 0, action: 0, referral: 0 },
      byAge: { under7Days: 0, from7To30Days: 0, over30Days: 0 },
    };
    const { unmount } = render(
      <ToastProvider>
        <ApprovalsView
          kind="determination"
          load={{ ok: true, data: { items: [], nextCursor: null, counts }, now }}
          viewer={ME}
          slug="tsc"
          paging={null}
        />
      </ToastProvider>,
    );
    expect(screen.getByText('All caught up')).toBeTruthy();
    unmount();
    render(
      <ToastProvider>
        <ApprovalsView
          kind="determination"
          load={{ ok: false, error: { kind: 'unavailable', detail: null }, now }}
          viewer={ME}
          slug="tsc"
          paging={null}
        />
      </ToastProvider>,
    );
    expect(screen.getByText('Could not load approvals')).toBeTruthy();
  });

  it('shows skeleton cards while the first page loads', () => {
    render(
      <ToastProvider>
        <ApprovalsView kind="determination" load={null} viewer={ME} slug="tsc" paging={null} />
      </ToastProvider>,
    );
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Determinations' })).toBeTruthy();
  });

  it('explains a supervisor-required refusal without offering Reassign (403)', async () => {
    await open();
    vi.mocked(approveCaseDetermination).mockResolvedValueOnce({
      ok: false,
      refusal: { kind: 'supervisor-required' },
    });
    fireEvent.click(within(card('Mary Achieng')).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve determination' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve determination' }));
    const notice = await screen.findByRole('dialog', { name: 'You cannot approve this' });
    expect(within(notice).getByText('Only a supervisor can approve this.')).toBeTruthy();
    expect(within(notice).getByText('403 supervisor-required')).toBeTruthy();
    expect(
      within(notice).getByText('Your account is not a supervisor of this Commission any more.'),
    ).toBeTruthy();
    expect(
      within(notice).queryByRole('button', { name: 'Reassign to another supervisor' }),
    ).toBeNull();
  });

  it('keeps the approve dialog open when the session has ended', async () => {
    await open();
    vi.mocked(approveCaseDetermination).mockResolvedValueOnce({
      ok: false,
      refusal: null,
      error: { kind: 'unauthenticated' },
    });
    fireEvent.click(within(card('Mary Achieng')).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve determination' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve determination' }));
    expect(await within(dialog).findByText('Your session has ended. Sign in again.')).toBeTruthy();
  });

  it('says when it was decided before the reassignment (409 not-proposed)', async () => {
    await open();
    // Its proposer withdraws it meanwhile.
    const { withdrawDetermination } = await import('../../server/determinations.server');
    await withdrawDetermination(
      mockReviewClient(MOCK_OFFICERS.mercy.subject, MOCK_OFFICERS.mercy.name),
      D.awaitingOfRecord,
    );
    fireEvent.click(
      within(card('Esther Moraa Onyango')).getByRole('button', {
        name: 'Reassign to another supervisor',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Reassign to another supervisor' });
    fireEvent.click(await within(dialog).findByRole('radio', { name: 'Lucy Wambui' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reassign' }));
    const notice = await screen.findByRole('dialog', { name: 'Already decided' });
    expect(within(notice).getByText('409 not-proposed')).toBeTruthy();
  });

  it('says when the supervisors could not be loaded, or there is no other one', async () => {
    await open();
    const reassignOf = () =>
      within(card('Esther Moraa Onyango')).getByRole('button', {
        name: 'Reassign to another supervisor',
      });
    vi.mocked(getSupervisors).mockResolvedValueOnce({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    });
    fireEvent.click(reassignOf());
    let dialog = await screen.findByRole('dialog', { name: 'Reassign to another supervisor' });
    expect(
      await within(dialog).findByText('The list of supervisors could not be loaded.'),
    ).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Reassign' }).hasAttribute('disabled')).toBe(
      true,
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    vi.mocked(getSupervisors).mockResolvedValueOnce({ ok: true, data: [] });
    fireEvent.click(reassignOf());
    dialog = await screen.findByRole('dialog', { name: 'Reassign to another supervisor' });
    expect(
      await within(dialog).findByText('Your Commission has no other supervisor.'),
    ).toBeTruthy();
  });

  it('keeps the reassign dialog open when reassigning fails', async () => {
    await open();
    vi.mocked(reassignToSupervisor).mockResolvedValueOnce({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    });
    fireEvent.click(
      within(card('Esther Moraa Onyango')).getByRole('button', {
        name: 'Reassign to another supervisor',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Reassign to another supervisor' });
    fireEvent.click(await within(dialog).findByRole('radio', { name: 'Lucy Wambui' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reassign' }));
    expect(
      await within(dialog).findByText('That did not work. Try again in a moment.'),
    ).toBeTruthy();
  });

  it('names a system proposer in a sentence: "Proposed by the system"', async () => {
    const load = await inbox();
    if (!load.ok) throw new Error('inbox');
    const [first] = load.data.items;
    if (!first) throw new Error('no item');
    const system = { ...first, proposerKind: 'system' as const, proposer: null };
    render(
      <ToastProvider>
        <ApprovalsView
          kind="determination"
          load={{ ...load, data: { ...load.data, items: [system] } }}
          viewer={ME}
          slug="tsc"
          paging={null}
        />
      </ToastProvider>,
    );
    expect(screen.getByText('Proposed by the system')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve determination' });
    expect(within(dialog).getByText(/^Proposed by the system on /)).toBeTruthy();
  });
});
