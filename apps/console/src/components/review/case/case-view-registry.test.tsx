// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  caseData,
  caseItem,
  CHECKED_AT,
  DISSOLVED_FLAG,
  DOCUMENT,
  ME,
  registryView,
  SUPPLIER_NOT_RUN_FLAG,
  VEHICLE_FLAG,
  WAFULA,
} from '../../../review-case/fixtures';
import {
  getCaseRegistry,
  getCaseRegistryStatus,
  markCaseFlagReviewed,
  recheckCaseRegistries,
} from '../../../server/review-case';
import type {
  CaseView as CaseViewData,
  CaseViewDetail,
  JsonObject,
} from '../../../server/review-case.server';
import type * as SignInRedirect from '../../sign-in-redirect';
import { goToSignIn } from '../../sign-in-redirect';
import { CaseView } from './case-view';

/**
 * The case view's Registry tab and Re-check (spec 07b FE-2), on a case from the fixtures; the
 * rest of the case view is covered by case-view.test.tsx against the review mock.
 */

const invalidate = vi.fn(() => Promise.resolve());
const scrollIntoView = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ invalidate, state: { matches: [] } }),
}));
vi.mock('../../../server/clarifications', () => ({
  saveClarificationDraft: vi.fn(),
  issueComposedClarification: vi.fn(),
}));
// The copilot's first read never lands: these tests are about the registry.
vi.mock('../../../server/copilot', () => ({
  getCaseCopilot: vi.fn(() => new Promise(() => undefined)),
  refreshCaseCopilot: vi.fn(),
  rateCopilotOutput: vi.fn(),
}));
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

vi.mock('../../sign-in-redirect', async (importOriginal) => ({
  ...(await importOriginal<typeof SignInRedirect>()),
  goToSignIn: vi.fn(),
}));

const NOW = Date.parse('2026-10-02T09:00:00Z');

function load(detail: Omit<CaseViewDetail, 'document'> = caseData()): CaseViewData {
  return {
    detail: { ...detail, document: DOCUMENT as unknown as JsonObject },
    documentUnavailable: false,
    viewer: { subject: ME.subject, name: ME.name },
  };
}

function held() {
  return load(caseData({ case: caseItem({ assignee: ME, status: 'assigned' }) }));
}

/** Renders the case and opens its Registry tab (`open: false` leaves it on Flags). */
function view(loaded: CaseViewData, { supervisor = false, open = true } = {}) {
  render(
    <TooltipProvider>
      <ToastProvider>
        <CaseView
          load={loaded}
          now={new Date(NOW).toISOString()}
          supervisor={supervisor}
          slug="psc"
          commission={{ name: 'Public Service Commission', issuerCode: 'PSC' }}
        />
      </ToastProvider>
    </TooltipProvider>,
  );
  if (open) {
    const tab = screen.getByRole('tab', { name: /Registry/ });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
  }
}

const ok = <T,>(data: T) => ({ ok: true as const, data });

/** The innermost element reading `text`, also when part of it is in a span of its own. */
const wholeText = (text: string) => (_: string, element: Element | null) =>
  element?.textContent === text &&
  ![...element.children].some((child) => child.textContent === text);

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = scrollIntoView;
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => undefined;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
});

describe('CaseView: Registry tab', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the registry when the tab opens and shows a status row per registry and person', async () => {
    vi.mocked(getCaseRegistry).mockResolvedValue(ok(registryView()));
    view(held());

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
    view(held());

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

  it('S6: names notes on the collapsed row: a matched BRS with the supplier check not run is not "all declared"', async () => {
    const registry = registryView();
    const brs = registry.persons[0]?.systems.find((entry) => entry.system === 'brs');
    if (!brs) throw new Error('no BRS row');
    brs.status = 'matched';
    brs.rows = brs.rows.map((row) => ({ ...row, relation: 'matched' }));
    brs.flags = [SUPPLIER_NOT_RUN_FLAG, DISSOLVED_FLAG];
    vi.mocked(getCaseRegistry).mockResolvedValue(ok(registry));
    view(held());

    const wanjiku = await screen.findByRole('list', {
      name: 'Registry checks for Wanjiku Njoki Kamau',
    });
    expect(within(wanjiku).getByText('1 record, supplier check not run, 1 note')).toBeTruthy();
    expect(within(wanjiku).queryByText(/all declared/)).toBeNull();
  });

  it("S6: names the supplier check not run when only the last check's statuses could be loaded", async () => {
    vi.mocked(getCaseRegistry).mockResolvedValue({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    });
    const detail = caseData({
      case: caseItem({ assignee: ME, status: 'assigned' }),
      flags: [SUPPLIER_NOT_RUN_FLAG],
      registry: {
        checkedAt: CHECKED_AT,
        recheckAvailableAt: null,
        checks: [
          {
            personKey: 'officer',
            system: 'brs',
            status: 'matched',
            reason: null,
            checkedAt: CHECKED_AT,
            resultId: null,
          },
        ],
      },
    });
    view(load(detail));

    expect(await screen.findByText('No indicators, supplier check not run')).toBeTruthy();
    expect(screen.queryByText('All records declared')).toBeNull();
  });

  it("shows the last check's statuses when the records could not be loaded", async () => {
    vi.mocked(getCaseRegistry)
      .mockResolvedValueOnce({ ok: false, error: { kind: 'unavailable', detail: null } })
      .mockResolvedValueOnce(ok(registryView()));
    const detail = caseData({
      case: caseItem({ assignee: ME, status: 'assigned' }),
      registry: {
        checkedAt: CHECKED_AT,
        recheckAvailableAt: null,
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
    view(load(detail));

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
    view(held());
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

  it('Q4: stops polling and signs in again when the session ends during a re-check', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(getCaseRegistry).mockResolvedValue(ok(registryView()));
    vi.mocked(getCaseRegistryStatus).mockResolvedValue({
      ok: false,
      error: { kind: 'unauthenticated' },
    });
    vi.mocked(recheckCaseRegistries).mockResolvedValue({ ok: true });
    view(held());
    await screen.findByRole('list', { name: 'Registry checks for Wanjiku Njoki Kamau' });
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    const dialog = await screen.findByRole('dialog', { name: 'Re-check registries' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Re-check' }));
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(goToSignIn).toHaveBeenCalledTimes(1);
    // The first status read said signed out: no more polls.
    expect(getCaseRegistryStatus).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('says when the next re-check is accepted (429)', async () => {
    vi.mocked(getCaseRegistry).mockResolvedValue(ok(registryView()));
    vi.mocked(recheckCaseRegistries).mockResolvedValue({
      ok: false,
      refusal: { kind: 'cooldown', retryAfterSeconds: 400 },
    });
    view(held());

    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    const dialog = await screen.findByRole('dialog', { name: 'Re-check registries' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Re-check' }));
      await Promise.resolve();
    });

    // The toast and the tab say it; the blocked button is described by it.
    expect(await screen.findAllByText('Re-checked recently. Try again in 7 minutes.')).toHaveLength(
      3,
    );
    expect(
      screen.getByRole('button', {
        name: 'Re-check',
        description: 'Re-checked recently. Try again in 7\u00a0minutes.',
      }),
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables Re-check within ten minutes of the last one, saying when it is accepted, then enables it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    vi.mocked(getCaseRegistry).mockResolvedValue(ok(registryView()));
    const detail = caseData({
      case: caseItem({ assignee: ME, status: 'assigned' }),
      registry: {
        ...caseData().registry,
        recheckAvailableAt: new Date(NOW + 6 * 60_000 + 20_000).toISOString(),
      },
    });
    view(load(detail));

    // Q16: blocked but focusable, named, and described by why; a press does nothing.
    const button = screen.getByRole('button', {
      name: 'Re-check',
      description: 'Re-checked recently. Try again in 7\u00a0minutes.',
    });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
    // Nothing was refused on this page: the tab does not repeat it.
    expect(
      within(screen.getByRole('tabpanel')).queryByText(
        'Re-checked recently. Try again in 7 minutes.',
      ),
    ).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(
      screen.getByRole('button', {
        name: 'Re-check',
        description: 'Re-checked recently. Try again in 6\u00a0minutes.',
      }),
    ).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 30_000);
    });
    const enabled = screen.getByRole('button', { name: 'Re-check', description: '' });
    expect(enabled.hasAttribute('aria-disabled')).toBe(false);
    expect((enabled as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(enabled);
    expect(await screen.findByRole('dialog', { name: 'Re-check registries' })).toBeTruthy();
    vi.useRealTimers();
  });

  it('disables Re-check for a reviewer who does not hold the case', () => {
    vi.mocked(getCaseRegistry).mockResolvedValue(ok(registryView()));
    view(load(caseData({ case: caseItem({ assignee: WAFULA, status: 'assigned' }) })), {
      open: false,
    });

    // Q16: blocked but focusable, named, and described by why; a press does nothing.
    const button = screen.getByRole('button', {
      name: 'Re-check',
      description: 'Only the assigned reviewer or a supervisor can re-check the registries.',
    });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
    // Not read until the tab opens: each read is an audited view of the declaration.
    expect(getCaseRegistry).not.toHaveBeenCalled();
  });
});
