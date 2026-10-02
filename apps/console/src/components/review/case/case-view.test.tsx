// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  caseData,
  caseItem,
  CHECKED_AT,
  DOCUMENT,
  flag,
  ME,
  PLOT,
  registryView,
  SALARY,
  VEHICLE_FLAG,
  WAFULA,
} from '../../../review-case/fixtures';
import type { CaseTab } from '../../../review-case/tabs';
import {
  addCaseNote,
  claimCase,
  getCaseRegistry,
  getCaseRegistryStatus,
  getReviewers,
  markCaseFlagReviewed,
  reassignCase,
  recheckCaseRegistries,
  releaseCase,
} from '../../../server/review-case';
import type { CaseLoad } from '../../../server/review-case.server';
import { CaseView } from './case-view';

const invalidate = vi.fn(() => Promise.resolve());
const scrollIntoView = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ invalidate }),
}));
// The Clarifications tab reuses the clarification detail's status badge.
vi.mock('../../../server/clarifications', () => ({}));
vi.mock('../../../server/review-case', () => ({
  addCaseNote: vi.fn(),
  claimCase: vi.fn(),
  getCaseAttachmentLink: vi.fn(),
  getCaseRegistry: vi.fn(),
  getCaseRegistryStatus: vi.fn(),
  getReviewers: vi.fn(),
  markCaseFlagReviewed: vi.fn(),
  reassignCase: vi.fn(),
  recheckCaseRegistries: vi.fn(),
  releaseCase: vi.fn(),
}));

const NOW = Date.parse('2026-10-02T09:00:00Z');
const reviewer = { ...ME, supervisor: false };
const supervisor = { ...ME, supervisor: true };

function load(overrides: Partial<CaseLoad> = {}): CaseLoad {
  return { detail: caseData(), document: DOCUMENT, documentUnavailable: false, ...overrides };
}

function view(
  loaded: CaseLoad,
  viewer: typeof reviewer = reviewer,
  tab: CaseTab = 'flags',
  onTab = vi.fn(),
) {
  return (
    <TooltipProvider>
      <ToastProvider>
        <CaseView load={loaded} viewer={viewer} slug="psc" now={NOW} tab={tab} onTab={onTab} />
      </ToastProvider>
    </TooltipProvider>
  );
}

const ok = <T,>(data: T) => ({ ok: true as const, data });

/** The innermost element reading `text`, also when part of it is in a span of its own. */
const wholeText = (text: string) => (_: string, element: Element | null) =>
  element?.textContent === text &&
  ![...element.children].some((child) => child.textContent === text);

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = scrollIntoView;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
});

describe('CaseView', () => {
  it('shows an unassigned case with Claim, and its flags grouped by severity', () => {
    render(view(load()));

    expect(screen.getByRole('heading', { level: 1, name: 'Wanjiku Kamau' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Claim' })).toBeTruthy();
    expect(screen.queryByText(/Read-only/)).toBeNull();
    expect(
      screen.getByText('Flags are indicators to guide your review. They are not findings.'),
    ).toBeTruthy();
    const groups = screen.getAllByRole('region').map((each) => each.getAttribute('aria-label'));
    expect(groups).toContain('High: 1');
    expect(groups.indexOf('High: 1')).toBeLessThan(groups.indexOf('Medium: 2'));
    // Only the reviewer holding the case marks flags reviewed.
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).toBeNull();
    expect(
      screen.getByText('Your access to this declaration is recorded in the audit trail.'),
    ).toBeTruthy();
  });

  it('claims the case', async () => {
    vi.mocked(claimCase).mockResolvedValue(ok(caseItem({ assignee: ME })));
    render(view(load()));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
      await Promise.resolve();
    });

    expect(claimCase).toHaveBeenCalledWith({ data: { caseId: caseItem().id } });
    expect(invalidate).toHaveBeenCalled();
    expect(await screen.findByText('Case claimed. You hold it now.')).toBeTruthy();
  });

  it('says who claimed it first when the claim lost the race (409)', async () => {
    vi.mocked(claimCase).mockResolvedValue({
      ok: false,
      error: {
        kind: 'problem',
        problem: { type: 'case-already-assigned', title: 'Case already assigned', status: 409 },
      },
    });
    const { rerender } = render(view(load()));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
      await Promise.resolve();
    });
    expect(invalidate).toHaveBeenCalled();
    // The reload brings the case as Wafula holds it.
    rerender(
      view(
        load({ detail: caseData({ case: caseItem({ assignee: WAFULA, status: 'assigned' }) }) }),
      ),
    );

    expect(await screen.findByText('Already claimed by Wafula Barasa')).toBeTruthy();
    expect(screen.getByText('Read-only. Wafula Barasa holds this case.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Claim' })).toBeNull();
  });

  it('marks a flag reviewed with a note, which is required', async () => {
    vi.mocked(markCaseFlagReviewed).mockResolvedValue(ok(flag()));
    render(view(load({ detail: caseData({ case: caseItem({ assignee: ME }) }) })));

    const card = screen.getByText('Value down 42% from the previous version').closest('li');
    if (!card) throw new Error('no flag card');
    fireEvent.click(within(card).getByRole('button', { name: 'Mark reviewed' }));
    const form = within(card).getByRole('form');
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Mark reviewed' }));
      await Promise.resolve();
    });
    expect(within(form).getByText('Add a note to record what you concluded.')).toBeTruthy();
    expect(markCaseFlagReviewed).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText('What did you conclude?'), {
      target: { value: '  Explained by the bank statement.  ' },
    });
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Mark reviewed' }));
      await Promise.resolve();
    });

    expect(markCaseFlagReviewed).toHaveBeenCalledWith({
      data: { caseId: caseItem().id, flagId: flag().id, note: 'Explained by the bank statement.' },
    });
    expect(invalidate).toHaveBeenCalled();
    expect(await screen.findByText('Marked reviewed')).toBeTruthy();
  });

  it('collapses a reviewed flag with its note and reviewer', () => {
    const reviewed = flag({
      reviewed: {
        at: '2026-10-02T07:47:00Z',
        by: WAFULA,
        note: 'Explained by the bank statement.',
      },
    });
    render(view(load({ detail: caseData({ flags: [reviewed] }) })));

    const group = screen.getByRole('region', { name: 'Reviewed' });
    expect(within(group).getByText('Reviewed by Wafula Barasa on 2 Oct 2026')).toBeTruthy();
    expect(within(group).getByText('Explained by the bank statement.')).toBeTruthy();
    expect(within(group).queryByText('Go to item')).toBeNull();
    expect(screen.getByText('0 open · 1 reviewed')).toBeTruthy();
  });

  it('goes to a flag’s item and highlights it, and a pin brings its flag back', () => {
    const onTab = vi.fn();
    render(view(load(), reviewer, 'notes', onTab));

    const salary = document.querySelector<HTMLElement>(`[data-item-id="${SALARY}"]`);
    if (!salary) throw new Error('no salary item');
    fireEvent.click(
      within(salary).getByRole('button', { name: '1 indicator on this item. Show in flags.' }),
    );
    expect(onTab).toHaveBeenCalledWith('flags');
    const card = screen.getByText('Value down 42% from the previous version').closest('li');
    if (!card) throw new Error('no flag card');
    expect(card.dataset.pulse).toBe('true');

    fireEvent.click(within(card).getByRole('button', { name: 'Go to item' }));
    const item = document.querySelector(`[data-item-id="${SALARY}"]`);
    expect(item?.getAttribute('data-highlighted')).toBe('true');
    expect(
      document.querySelector(`[data-item-id="${PLOT}"]`)?.hasAttribute('data-highlighted'),
    ).toBe(false);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('adds a note', async () => {
    vi.mocked(addCaseNote).mockResolvedValue(
      ok({ id: 'n1', author: ME, text: 'Checked the parcel.', at: '2026-10-02T09:00:00Z' }),
    );
    render(view(load(), reviewer, 'notes'));

    expect(
      screen.getByText('Notes are internal to your Commission. The declarant never sees them.'),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
      await Promise.resolve();
    });
    expect(screen.getByText('Write a note first.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Add note'), {
      target: { value: 'Checked the parcel.' },
    });
    expect(screen.getByText('19 / 2,000')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
      await Promise.resolve();
    });
    expect(addCaseNote).toHaveBeenCalledWith({
      data: { caseId: caseItem().id, text: 'Checked the parcel.' },
    });
    expect(await screen.findByText('Note added')).toBeTruthy();
  });

  it('shows the case without the declaration when it could not be loaded', async () => {
    render(view(load({ document: null, documentUnavailable: true })));

    expect(screen.getByText('The declaration could not be loaded.')).toBeTruthy();
    expect(screen.getByText('Assets grew faster than declared income')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await Promise.resolve();
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it('lets a holder release the case after confirming', async () => {
    vi.mocked(releaseCase).mockResolvedValue(ok(caseItem()));
    render(view(load({ detail: caseData({ case: caseItem({ assignee: ME }) }) })));

    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    const dialog = await screen.findByRole('dialog', { name: 'Release this case?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Release case' }));
      await Promise.resolve();
    });
    expect(releaseCase).toHaveBeenCalled();
    expect(await screen.findByText('Case released to the queue')).toBeTruthy();
  });

  it('lets a supervisor reassign to a reviewer of the Commission', async () => {
    vi.mocked(getReviewers).mockResolvedValue(
      ok([{ subject: 'm', name: 'Mercy Wambui', open: 11, ofRecord: true }]),
    );
    vi.mocked(reassignCase).mockResolvedValue(ok(caseItem()));
    render(
      view(
        load({
          detail: caseData({ case: caseItem({ assignee: WAFULA }), reviewerHistory: [WAFULA] }),
        }),
        supervisor,
      ),
    );

    expect(screen.getByRole('button', { name: 'Unassign' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reassign case' });
    expect(within(dialog).getByText('Currently held by Wafula Barasa.')).toBeTruthy();
    const mercy = await within(dialog).findByRole('radio', { name: 'Mercy Wambui' });
    expect(within(dialog).getByText('11 open cases · already a reviewer of record')).toBeTruthy();
    expect(getReviewers).toHaveBeenCalledWith({
      data: { slug: 'psc', assignee: WAFULA.subject, reviewerHistory: [WAFULA] },
    });

    fireEvent.click(mercy);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reassign' }));
      await Promise.resolve();
    });
    expect(reassignCase).toHaveBeenCalledWith({
      data: { caseId: caseItem().id, assignee: 'm' },
    });
    expect(await screen.findByText('Reassigned to Mercy Wambui')).toBeTruthy();
  });

  it('cues a supervisor who held the case', () => {
    render(view(load({ detail: caseData({ reviewerHistory: [ME] }) }), supervisor));

    expect(
      screen.getByText(
        'You are a reviewer of record, so another supervisor must approve the determination.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Assign to a reviewer' })).toBeTruthy();
  });
});

describe('CaseView: Registry tab', () => {
  const held = () =>
    load({ detail: caseData({ case: caseItem({ assignee: ME, status: 'assigned' }) }) });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the registry when the tab opens and shows a status row per registry and person', async () => {
    vi.mocked(getCaseRegistry).mockResolvedValue(ok(registryView()));
    render(view(held(), reviewer, 'registry'));

    expect(
      screen.getByText(
        'Registry checks compare the declaration with KRA, NTSA, BRS and ArdhiSasa. Mismatches are indicators for your review, not findings.',
      ),
    ).toBeTruthy();
    const wanjiku = await screen.findByRole('list', {
      name: 'Registry checks for Wanjiku Njoki Kamau',
    });
    expect(getCaseRegistry).toHaveBeenCalledWith({ data: { caseId: caseItem().id } });
    expect(within(wanjiku).getByText('PIN on record, compliant, income within 25%')).toBeTruthy();
    expect(
      within(wanjiku).getByText(
        wholeText('Could not reach ArdhiSasa. Re-checked automatically every hour.'),
      ),
    ).toBeTruthy();
    expect(within(wanjiku).getAllByText('Mismatched')).toHaveLength(2);
    const imani = screen.getByRole('list', { name: 'Registry checks for Imani Wairimu Kamau' });
    expect(within(imani).getByText('All registries')).toBeTruthy();
    expect(within(imani).getByText('No national ID declared')).toBeTruthy();
    expect(
      within(imani).getByText('Registries cannot be checked for Imani without an ID.'),
    ).toBeTruthy();
  });

  it('opens a registry to its records and indicators, and marks one reviewed there', async () => {
    vi.mocked(getCaseRegistry).mockResolvedValue(ok(registryView()));
    vi.mocked(markCaseFlagReviewed).mockResolvedValue(ok({ ...VEHICLE_FLAG }));
    render(view(held(), reviewer, 'registry'));

    fireEvent.click(await screen.findByRole('button', { name: 'NTSA' }));
    const table = screen.getByRole('table', { name: 'NTSA records beside the declared items' });
    expect(within(table).getByRole('rowheader', { name: /KDK 482M/ })).toBeTruthy();
    expect(within(table).getByText('Not declared')).toBeTruthy();
    const indicators = screen.getByRole('list', { name: 'NTSA indicators' });
    fireEvent.click(within(indicators).getByRole('button', { name: 'Mark reviewed' }));
    fireEvent.change(screen.getByLabelText('What did you conclude?'), {
      target: { value: 'Bought in 2024; the declarant will amend.' },
    });
    await act(async () => {
      fireEvent.click(within(indicators).getByRole('button', { name: 'Mark reviewed' }));
      await Promise.resolve();
    });

    expect(markCaseFlagReviewed).toHaveBeenCalledWith({
      data: {
        caseId: caseItem().id,
        flagId: VEHICLE_FLAG.id,
        note: 'Bought in 2024; the declarant will amend.',
      },
    });
    expect(await screen.findByText('Marked reviewed')).toBeTruthy();
  });

  it("shows the last check's statuses when the records could not be loaded", async () => {
    vi.mocked(getCaseRegistry)
      .mockResolvedValueOnce({ ok: false, error: { kind: 'unavailable', detail: null } })
      .mockResolvedValueOnce(ok(registryView()));
    const detail = caseData({
      case: caseItem({ assignee: ME, status: 'assigned' }),
      registry: {
        checkedAt: CHECKED_AT,
        checks: [
          {
            personKey: 'officer',
            system: 'ntsa',
            status: 'unavailable',
            reason: 'timeout',
            checkedAt: CHECKED_AT,
            resultId: null,
          },
        ],
      },
    });
    render(view(load({ detail }), reviewer, 'registry'));

    expect(
      await screen.findByText(
        'Registry records could not be loaded. Status is shown from the last check.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(wholeText('Could not reach NTSA. Re-checked automatically every hour.')),
    ).toBeTruthy();
    // The tab is marked: a registry could not be checked.
    expect(screen.getByRole('img', { name: 'A registry could not be checked' })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await Promise.resolve();
    });
    expect(
      await screen.findByRole('list', { name: 'Registry checks for Imani Wairimu Kamau' }),
    ).toBeTruthy();
  });

  it('re-checks after confirming, says it is checking, then shows the new results', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const after = { ...registryView(), checkedAt: '2026-10-02T09:01:00.000Z' };
    vi.mocked(getCaseRegistry)
      .mockResolvedValueOnce(ok(registryView()))
      .mockResolvedValue(ok(after));
    vi.mocked(getCaseRegistryStatus)
      .mockResolvedValueOnce(ok({ checkedAt: registryView().checkedAt }))
      .mockResolvedValue(ok({ checkedAt: after.checkedAt }));
    vi.mocked(recheckCaseRegistries).mockResolvedValue({ ok: true });
    render(view(held(), reviewer, 'registry'));
    await screen.findByRole('list', { name: 'Registry checks for Wanjiku Njoki Kamau' });

    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    const dialog = await screen.findByRole('dialog', { name: 'Re-check registries' });
    expect(
      within(dialog).getByText(
        'Re-check all registries for this case? Reviewed flags keep your notes.',
      ),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Re-check' }));
      await Promise.resolve();
    });

    expect(recheckCaseRegistries).toHaveBeenCalledWith({ data: { caseId: caseItem().id } });
    const running = screen.getByRole('button', { name: 'Checking…' });
    expect((running as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText('Checking…').length).toBeGreaterThan(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(await screen.findByText('Registry checks updated')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Re-check' })).toBeTruthy();
    expect(invalidate).toHaveBeenCalled();
    // Polled the unaudited status; read the audited records once when the tab opened, once after.
    expect(getCaseRegistryStatus).toHaveBeenCalledTimes(2);
    expect(getCaseRegistry).toHaveBeenCalledTimes(2);
  });

  it('says when the next re-check is accepted (429)', async () => {
    vi.mocked(getCaseRegistry).mockResolvedValue(ok(registryView()));
    vi.mocked(recheckCaseRegistries).mockResolvedValue({
      ok: false,
      refusal: { kind: 'cooldown', retryAfterSeconds: 400 },
    });
    render(view(held(), reviewer, 'registry'));

    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    const dialog = await screen.findByRole('dialog', { name: 'Re-check registries' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Re-check' }));
      await Promise.resolve();
    });

    expect(await screen.findAllByText('Re-checked recently. Try again in 7 minutes.')).toHaveLength(
      2,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables Re-check for a reviewer who does not hold the case', () => {
    vi.mocked(getCaseRegistry).mockResolvedValue(ok(registryView()));
    render(
      view(
        load({ detail: caseData({ case: caseItem({ assignee: WAFULA, status: 'assigned' }) }) }),
      ),
    );

    const button = screen.getByRole('button', { name: 'Re-check' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // Not read until the tab opens: each read is an audited view of the declaration.
    expect(getCaseRegistry).not.toHaveBeenCalled();
  });
});
