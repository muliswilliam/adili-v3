// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { GateRule, GateRuleInput, TenantUsage } from '../../server/ai-gateway/types';
import { type AiPolicyOverview, type AiTenantRow, gateOf } from '../../server/ai-policy.server';
import type { ServiceResult } from '../../server/service-call';
import { AiPolicyView } from './ai-policy-view';
import type { SaveBudget } from './budget-dialog';
import type { SaveGate } from './gate-dialog';
import type { RemoveRoute, SaveRoute } from './route-dialog';

const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }));

const allowSynthetic: GateRule = {
  dataClass: 'synthetic',
  providerClass: 'external',
  allowed: true,
  approvalRef: 'EACC/AI/2026/014',
  changedBy: '7d1c2a4e-0000-4000-8000-00000000a001',
  changedByName: 'Amina Wanjiru',
  changedAt: '2026-09-01T08:40:00Z',
};

/** The gateway's default gate: self-hosted sees everything, external nothing. */
const DEFAULTS: GateRuleInput[] = (
  ['synthetic', 'restricted', 'highly-confidential'] as const
).flatMap((dataClass) =>
  (['external', 'self-hosted'] as const).map((providerClass) => ({
    dataClass,
    providerClass,
    allowed: providerClass === 'self-hosted',
  })),
);

/** A Commission's gate and its routes, all to an external provider. */
const policy = (rules: GateRule[]) => ({
  gate: gateOf(DEFAULTS, rules),
  routed: ['external' as const],
});

function usage(tokensUsed: number, monthlyTokens: number, extra: Partial<TenantUsage> = {}) {
  return {
    tenant: 'x',
    month: '2026-09',
    monthlyTokens,
    perMinute: 60,
    tokensUsed,
    costMicros: 24_180_000,
    jobs: 1_482,
    blocked: 0,
    failed: 11,
    ...extra,
  } satisfies TenantUsage;
}

const PSC: AiTenantRow = {
  slug: 'psc',
  name: 'Public Service Commission',
  ...policy([allowSynthetic]),
  usage: usage(1_926_400, 3_000_000, { perMinute: 120 }),
};
const JSC: AiTenantRow = {
  slug: 'jsc',
  name: 'Judicial Service Commission',
  ...policy([{ ...allowSynthetic, approvalRef: 'EACC/AI/2026/019' }]),
  usage: usage(862_300, 1_000_000),
};
const NAIROBI: AiTenantRow = {
  slug: 'cpsbnairobicity',
  name: 'Nairobi City County Public Service Board',
  ...policy([{ ...allowSynthetic, approvalRef: 'EACC/AI/2026/021' }]),
  usage: usage(1_500_000, 1_500_000),
};
const TSC: AiTenantRow = {
  slug: 'tsc',
  name: 'Teachers Service Commission',
  ...policy([
    {
      ...allowSynthetic,
      allowed: false,
      approvalRef: 'TSC resolution 12/2026',
      changedByName: null,
    },
  ]),
  usage: usage(0, 1_000_000, { blocked: 214, jobs: 0, failed: 0, costMicros: 0 }),
};

const OVERVIEW: AiPolicyOverview = {
  tenants: [PSC, JSC, NAIROBI, TSC],
  routing: {
    ok: true,
    data: [
      {
        tenant: null,
        task: 'explain-flags',
        provider: 'anthropic',
        providerClass: 'external',
        model: 'claude-opus-5-5',
        params: { maxOutputTokens: 3_000, timeoutMs: 45_000 },
        configured: false,
      },
      {
        tenant: 'psc',
        task: 'draft-clarification',
        provider: 'anthropic',
        providerClass: 'external',
        model: 'claude-opus-5-5',
        params: { maxOutputTokens: 3_000, effort: 'low', timeoutMs: 10_000 },
        configured: false,
      },
      {
        tenant: null,
        task: 'summarize-declaration',
        provider: 'anthropic',
        providerClass: 'external',
        model: 'claude-opus-5-5',
        params: {},
        configured: true,
      },
    ],
  },
};

type Props = ComponentProps<typeof AiPolicyView>;

function renderView(overrides: Partial<Props> = {}) {
  const props: Props = {
    result: { ok: true, data: OVERVIEW },
    search: {},
    onSearchChange: vi.fn(),
    saveGate: vi.fn<SaveGate>(),
    saveBudget: vi.fn<SaveBudget>(),
    saveRoute: vi.fn<SaveRoute>(),
    removeRoute: vi.fn<RemoveRoute>(),
    onUnauthenticated: vi.fn(),
    ...overrides,
  };
  render(
    <TooltipProvider>
      <ToastProvider>
        <AiPolicyView {...props} />
      </ToastProvider>
    </TooltipProvider>,
  );
  return props;
}

const rowOf = (name: string) => {
  const row = screen.getByRole('button', { name }).closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return within(row);
};

describe('S16 AI policy: Commissions', () => {
  it('shows the gate per data class, usage and rate limit per Commission', () => {
    renderView();
    expect(screen.getByRole('heading', { name: 'AI policy' })).toBeTruthy();
    expect(screen.getByText('3 of 4 Commissions enabled')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Usage, Sep 2026' })).toBeTruthy();
    const psc = rowOf('Public Service Commission');
    // Only the routed provider class shows; nothing is routed to a self-hosted one.
    expect(psc.getByText('External')).toBeTruthy();
    expect(psc.getAllByText('Blocked')).toHaveLength(2);
    expect(psc.getByRole('meter').getAttribute('aria-label')).toBe(
      'Tokens this month: 1,926,400 of 3,000,000',
    );
    expect(psc.getByText('120/min')).toBeTruthy();
    const tsc = rowOf('Teachers Service Commission');
    expect(tsc.getAllByText('Blocked')).toHaveLength(3);
    expect(tsc.getByText('Not enabled · 214 blocked')).toBeTruthy();
    expect(tsc.queryByRole('meter')).toBeNull();
  });

  it('counts each filter and applies a chip through the search', () => {
    const { onSearchChange } = renderView({ search: { page: 2 } });
    expect(screen.getByRole('button', { name: /^Budget 80%\+ 2/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Not enabled 1/ }));
    expect(onSearchChange).toHaveBeenCalledWith({ show: 'not-enabled', page: undefined });
  });

  it('shows only the filtered rows', () => {
    renderView({ search: { show: 'budget' } });
    expect(screen.getByRole('button', { name: 'Judicial Service Commission' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Public Service Commission' })).toBeNull();
  });

  it('says when nothing matches', () => {
    renderView({ search: { q: 'zzz' } });
    expect(screen.getByText('No Commissions here')).toBeTruthy();
  });

  it('shows skeletons and no count while loading', () => {
    renderView({ result: null });
    expect(screen.queryByText(/Commissions enabled/)).toBeNull();
    expect(
      screen.getByRole('table', { name: /Classification gate/ }).getAttribute('aria-busy'),
    ).toBe('true');
  });

  it('offers to try again when the gateway does not answer', () => {
    renderView({ result: { ok: false, error: { kind: 'unavailable', detail: null } } });
    expect(screen.getByText('AI policy could not be loaded.')).toBeTruthy();
    expect(screen.getByText('Nothing has changed. Try again in a moment.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(invalidate).toHaveBeenCalled();
  });

  it('S14 tells anyone the gateway refuses that only platform admins see AI policy', () => {
    const forbidden: ServiceResult<never> = {
      ok: false,
      error: { kind: 'problem', problem: { type: 'about:blank', title: 'Forbidden', status: 403 } },
    };
    renderView({ result: forbidden });
    expect(screen.getByText('Only platform administrators can see AI policy.')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});

describe('S16 AI policy: a Commission', () => {
  it('opens the drawer with the gate, usage and changes', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Public Service Commission' }));
    const drawer = within(screen.getByRole('dialog', { name: 'Public Service Commission' }));
    expect(drawer.getByText('External provider, synthetic data only')).toBeTruthy();
    expect(drawer.getByText('EACC/AI/2026/014', { selector: 'span.block' })).toBeTruthy();
    expect(drawer.getByRole('heading', { name: 'Usage, September 2026' })).toBeTruthy();
    expect(drawer.getByText('USD 24.18')).toBeTruthy();
    expect(drawer.getByText('3,000,000 tokens')).toBeTruthy();
    expect(drawer.getByText('120 a minute')).toBeTruthy();
    expect(drawer.getByText('Allowed external providers for synthetic data')).toBeTruthy();
  });

  it('says when the budget is used up and when requests start again', () => {
    renderView();
    fireEvent.click(
      screen.getByRole('button', { name: 'Nairobi City County Public Service Board' }),
    );
    expect(
      screen.getByText('Budget used up. New AI requests are blocked until 1 Oct 2026.'),
    ).toBeTruthy();
  });

  it('says a Commission whose routed provider may see nothing is not enabled, and who decided', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Teachers Service Commission' }));
    const drawer = within(screen.getByRole('dialog', { name: 'Teachers Service Commission' }));
    expect(drawer.getByText('No declaration data is sent to an AI provider')).toBeTruthy();
    expect(drawer.getByText('No declaration data is sent to an AI provider')).toBeTruthy();
    expect(drawer.getByText('Blocked external providers for synthetic data')).toBeTruthy();
    // The rule names the account when the gateway has no display name for it.
    expect(drawer.getByText(/^7d1c2a4e-0000-4000-8000-00000000a001 ·/)).toBeTruthy();
    // Cells without a rule of the Commission's own follow the default.
    expect(drawer.getAllByText('Default')).toHaveLength(5);
  });

  it('says when a Commission has only the default gate', () => {
    renderView({
      result: {
        ok: true,
        data: { ...OVERVIEW, tenants: [{ ...TSC, ...policy([]) }] },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Teachers Service Commission' }));
    const drawer = within(screen.getByRole('dialog', { name: 'Teachers Service Commission' }));
    expect(drawer.getByText('No declaration data is sent to an AI provider')).toBeTruthy();
    expect(
      drawer.getByText('No changes. The default applies: external providers see no data.'),
    ).toBeTruthy();
  });

  it('allows external providers on synthetic data once the approval reference is recorded', async () => {
    const saveGate = vi.fn<SaveGate>().mockResolvedValue({
      ok: true,
      data: { tenant: 'tsc', rules: [allowSynthetic] },
    });
    renderView({ saveGate });
    fireEvent.click(screen.getByRole('button', { name: 'Teachers Service Commission' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit policy' }));

    const edit = within(screen.getByRole('dialog', { name: 'Edit gate policy' }));
    const continueButton = edit.getByRole('button', { name: 'Continue' });
    expect(continueButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(edit.getByLabelText('Allow external providers for synthetic data'));
    fireEvent.click(continueButton);

    const confirm = within(screen.getByRole('dialog', { name: 'Confirm policy change' }));
    expect(
      confirm.getByText(
        'External providers may process synthetic data for Teachers Service Commission.',
      ),
    ).toBeTruthy();
    fireEvent.click(confirm.getByRole('button', { name: 'Save policy' }));
    expect(confirm.getByText('Enter the approval reference.')).toBeTruthy();
    expect(saveGate).not.toHaveBeenCalled();

    fireEvent.change(confirm.getByLabelText('Record the approval reference.'), {
      target: { value: ' EACC/AI/2026/022 ' },
    });
    fireEvent.click(confirm.getByRole('button', { name: 'Save policy' }));
    await waitFor(() => {
      expect(saveGate).toHaveBeenCalledWith({
        tenant: 'tsc',
        changes: [{ dataClass: 'synthetic', providerClass: 'external', allowed: true }],
        approvalRef: 'EACC/AI/2026/022',
      });
    });
    await screen.findByText('Policy saved and recorded in the audit trail');
    expect(invalidate).toHaveBeenCalled();
    // Back to the Commission's drawer.
    expect(screen.getByRole('dialog', { name: 'Teachers Service Commission' })).toBeTruthy();
  });

  it('warns that blocking stops new requests', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Public Service Commission' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit policy' }));
    fireEvent.click(screen.getByLabelText('Allow external providers for synthetic data'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByText(
        'External providers will no longer process synthetic data for Public Service Commission. New AI requests are blocked; outputs already shown stay.',
      ),
    ).toBeTruthy();
  });

  it('says nothing was changed when the save fails', async () => {
    invalidate.mockClear();
    const saveGate = vi.fn<SaveGate>().mockResolvedValue({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    });
    renderView({ saveGate });
    fireEvent.click(screen.getByRole('button', { name: 'Teachers Service Commission' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit policy' }));
    fireEvent.click(screen.getByLabelText('Allow external providers for synthetic data'));
    fireEvent.click(screen.getByLabelText('Allow external providers for restricted data'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Record the approval reference.'), {
      target: { value: 'EACC/AI/2026/022' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    expect(await screen.findByText('The policy could not be saved.')).toBeTruthy();
    expect(screen.getByText('Nothing was changed. Try again in a moment.')).toBeTruthy();
    expect(saveGate).toHaveBeenCalledWith({
      tenant: 'tsc',
      changes: [
        { dataClass: 'synthetic', providerClass: 'external', allowed: true },
        { dataClass: 'restricted', providerClass: 'external', allowed: true },
      ],
      approvalRef: 'EACC/AI/2026/022',
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('checks the budget, warns below usage and saves it', async () => {
    const saveBudget = vi.fn<SaveBudget>().mockResolvedValue({
      ok: true,
      data: usage(1_926_400, 2_500_000),
    });
    renderView({ saveBudget });
    fireEvent.click(screen.getByRole('button', { name: 'Public Service Commission' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit budget' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Edit budget' }));
    const tokens = dialog.getByLabelText<HTMLInputElement>('Monthly tokens');
    expect(tokens.value).toBe('3,000,000');
    expect(dialog.getByText('Used this month: 1,926,400')).toBeTruthy();

    fireEvent.change(tokens, { target: { value: '1,500,000' } });
    expect(
      dialog.getByText("Below this month's usage. New AI requests are blocked until 1 Oct 2026."),
    ).toBeTruthy();
    fireEvent.change(dialog.getByLabelText('Requests a minute'), { target: { value: '0' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save budget' }));
    expect(dialog.getByText('Enter at least 1 request a minute.')).toBeTruthy();
    expect(saveBudget).not.toHaveBeenCalled();

    fireEvent.change(tokens, { target: { value: '2,500,000' } });
    fireEvent.change(dialog.getByLabelText('Requests a minute'), { target: { value: '90' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save budget' }));
    await waitFor(() => {
      expect(saveBudget).toHaveBeenCalledWith({
        tenant: 'psc',
        monthlyTokens: 2_500_000,
        perMinute: 90,
      });
    });
    await screen.findByText('Budget saved');
  });
});

describe('S16 AI policy: routing', () => {
  it('lists task, scope, provider, model and parameters', () => {
    renderView({ search: { tab: 'routing' } });
    expect(
      screen.getByText(
        'Changes take effect at the next request and are recorded in the audit trail.',
      ),
    ).toBeTruthy();
    const table = within(
      screen.getByRole('table', { name: 'Routing: task to provider and model' }),
    );
    expect(table.getByText('explain-flags')).toBeTruthy();
    expect(table.getAllByText('All Commissions')).toHaveLength(2);
    // A Commission's override names it.
    expect(table.getByText('Public Service Commission')).toBeTruthy();
    expect(table.getAllByText('Anthropic')).toHaveLength(3);
    expect(table.getByText('45 s')).toBeTruthy();
    expect(table.getAllByText('3,000')).toHaveLength(2);
    expect(table.getByText('Low')).toBeTruthy();
  });

  it("says a route without parameters uses the task's own", () => {
    renderView({
      result: {
        ok: true,
        data: {
          ...OVERVIEW,
          routing: {
            ok: true,
            data: [
              {
                tenant: null,
                task: 'summarize-declaration',
                provider: 'anthropic',
                providerClass: 'external',
                model: 'claude-opus-5-5',
                params: {},
                configured: true,
              },
            ],
          },
        },
      },
      search: { tab: 'routing' },
    });
    expect(screen.getByText('Task defaults')).toBeTruthy();
  });

  it('S2 switches a route to another model on an approval reference', async () => {
    const saveRoute = vi.fn<SaveRoute>().mockResolvedValue({
      ok: true,
      data: {
        tenant: null,
        task: 'explain-flags',
        provider: 'anthropic',
        providerClass: 'external',
        model: 'claude-sonnet-5',
        params: {},
        configured: false,
      },
    });
    renderView({ search: { tab: 'routing' }, saveRoute });

    fireEvent.click(
      screen.getByRole('button', { name: 'Edit route of explain-flags for All Commissions' }),
    );
    const dialog = within(screen.getByRole('dialog', { name: 'Edit route' }));
    expect(dialog.getByLabelText<HTMLInputElement>('Provider').value).toBe('anthropic');
    expect(dialog.getByLabelText<HTMLInputElement>(/^Max output tokens/).value).toBe('3000');
    expect(dialog.getByLabelText<HTMLInputElement>(/^Timeout/).value).toBe('45');
    fireEvent.change(dialog.getByLabelText('Model'), { target: { value: 'claude-sonnet-5' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save route' }));
    // The approval reference is required first.
    expect(await dialog.findByText('Enter the approval reference.')).toBeTruthy();
    expect(saveRoute).not.toHaveBeenCalled();

    fireEvent.change(dialog.getByLabelText(/^Record the approval reference/), {
      target: { value: 'EACC/AI/2026/030' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Save route' }));

    await waitFor(() => {
      expect(saveRoute).toHaveBeenCalledWith({
        tenant: null,
        task: 'explain-flags',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        params: { maxOutputTokens: 3000, timeoutMs: 45_000 },
        approvalRef: 'EACC/AI/2026/030',
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it('S2 says when the gateway cannot reach the provider', async () => {
    const saveRoute = vi.fn<SaveRoute>().mockResolvedValue({
      ok: false,
      error: {
        kind: 'problem',
        problem: {
          type: 'about:blank',
          title: 'Validation failed',
          status: 400,
          errors: [{ path: 'provider', message: 'Must be a provider this gateway reaches' }],
        } as never,
      },
    });
    renderView({ search: { tab: 'routing' }, saveRoute });

    fireEvent.click(
      screen.getByRole('button', { name: 'Edit route of explain-flags for All Commissions' }),
    );
    const dialog = within(screen.getByRole('dialog', { name: 'Edit route' }));
    fireEvent.change(dialog.getByLabelText('Provider'), { target: { value: 'elsewhere' } });
    fireEvent.change(dialog.getByLabelText(/^Record the approval reference/), {
      target: { value: 'EACC/AI/2026/031' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Save route' }));

    expect(await dialog.findByText('The AI gateway cannot reach this provider.')).toBeTruthy();
    expect(dialog.getByText('The gateway refused this route.')).toBeTruthy();
  });

  it("S2 removes a Commission's own route on an approval reference", async () => {
    const removeRoute = vi.fn<RemoveRoute>().mockResolvedValue({ ok: true, data: null });
    renderView({ search: { tab: 'routing' }, removeRoute });

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit route of draft-clarification for Public Service Commission',
      }),
    );
    const dialog = within(screen.getByRole('dialog', { name: 'Edit route' }));
    fireEvent.change(dialog.getByLabelText(/^Record the approval reference/), {
      target: { value: 'EACC/AI/2026/032' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Remove route' }));

    // Q21: a confirm step says what follows before anything is removed.
    const confirm = within(screen.getByRole('dialog', { name: 'Remove this route?' }));
    expect(
      confirm.getByText(
        "Public Service Commission's draft-clarification calls will follow the route for all Commissions again.",
      ),
    ).toBeTruthy();
    expect(removeRoute).not.toHaveBeenCalled();
    fireEvent.click(confirm.getByRole('button', { name: 'Back' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Edit route' })).getByRole('button', {
        name: 'Remove route',
      }),
    );
    let resolve: (result: { ok: true; data: null }) => void = () => undefined;
    removeRoute.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Remove this route?' })).getByRole('button', {
        name: 'Remove route',
      }),
    );

    await waitFor(() => {
      expect(removeRoute).toHaveBeenCalledWith({
        tenant: 'psc',
        task: 'draft-clarification',
        approvalRef: 'EACC/AI/2026/032',
      });
    });
    // N12: the busy label says what is happening.
    expect(screen.getByText('Removing…')).toBeTruthy();
    resolve({ ok: true, data: null });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('Q20 resets an edited default route to the configured provider, after a confirm', async () => {
    const removeRoute = vi.fn<RemoveRoute>().mockResolvedValue({ ok: true, data: null });
    renderView({ search: { tab: 'routing' }, removeRoute });

    fireEvent.click(
      screen.getByRole('button', { name: 'Edit route of explain-flags for All Commissions' }),
    );
    const dialog = within(screen.getByRole('dialog', { name: 'Edit route' }));
    expect(dialog.queryByRole('button', { name: 'Remove route' })).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: 'Reset to configured' }));
    // The approval reference is required first.
    expect(await dialog.findByText('Enter the approval reference.')).toBeTruthy();
    fireEvent.change(dialog.getByLabelText(/^Record the approval reference/), {
      target: { value: 'EACC/AI/2026/034' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Reset to configured' }));
    const confirm = within(screen.getByRole('dialog', { name: 'Reset this route?' }));
    expect(confirm.getByText(/configured provider and model/)).toBeTruthy();
    fireEvent.click(confirm.getByRole('button', { name: 'Reset route' }));

    await waitFor(() => {
      expect(removeRoute).toHaveBeenCalledWith({
        tenant: null,
        task: 'explain-flags',
        approvalRef: 'EACC/AI/2026/034',
      });
    });
  });

  it('Q20 offers no reset for a task already on the configured provider', () => {
    renderView({ search: { tab: 'routing' } });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit route of summarize-declaration for All Commissions',
      }),
    );
    const dialog = within(screen.getByRole('dialog', { name: 'Edit route' }));
    expect(dialog.queryByRole('button', { name: 'Reset to configured' })).toBeNull();
    expect(dialog.queryByRole('button', { name: 'Remove route' })).toBeNull();
  });

  it("Q19 warns that adding a Commission's route it already has replaces it", () => {
    const saveRoute = vi.fn<SaveRoute>().mockResolvedValue({
      ok: true,
      data: {
        tenant: 'psc',
        task: 'draft-clarification',
        provider: 'anthropic',
        providerClass: 'external',
        model: 'claude-opus-5-5',
        params: {},
        configured: false,
      },
    });
    renderView({ search: { tab: 'routing' }, saveRoute });

    fireEvent.click(screen.getByRole('button', { name: "Add a Commission's route" }));
    const dialog = within(screen.getByRole('dialog', { name: "Add a Commission's route" }));
    // The first Commission (psc) already routes draft-clarification, the task shown first.
    expect(
      dialog.getByText(
        'Public Service Commission already has its own route of draft-clarification. Saving replaces it.',
      ),
    ).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Replace route' })).toBeTruthy();
    expect(dialog.queryByRole('button', { name: 'Save route' })).toBeNull();
  });

  it("S2 adds a Commission's own route", async () => {
    const saveRoute = vi.fn<SaveRoute>().mockResolvedValue({
      ok: true,
      data: {
        tenant: 'psc',
        task: 'draft-clarification',
        provider: 'anthropic',
        providerClass: 'external',
        model: 'claude-opus-5-5',
        params: {},
        configured: false,
      },
    });
    // No Commission has its own route yet.
    const routing = OVERVIEW.routing.ok ? OVERVIEW.routing.data : [];
    renderView({
      result: {
        ok: true,
        data: { ...OVERVIEW, routing: { ok: true, data: routing.filter((each) => !each.tenant) } },
      },
      search: { tab: 'routing' },
      saveRoute,
    });

    fireEvent.click(screen.getByRole('button', { name: "Add a Commission's route" }));
    const dialog = within(screen.getByRole('dialog', { name: "Add a Commission's route" }));
    expect(dialog.queryByRole('button', { name: 'Remove route' })).toBeNull();
    fireEvent.change(dialog.getByLabelText('Provider'), { target: { value: 'anthropic' } });
    fireEvent.change(dialog.getByLabelText('Model'), { target: { value: 'claude-opus-5-5' } });
    fireEvent.change(dialog.getByLabelText(/^Record the approval reference/), {
      target: { value: 'EACC/AI/2026/033' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Save route' }));

    await waitFor(() => {
      expect(saveRoute).toHaveBeenCalledWith({
        tenant: 'psc',
        task: 'draft-clarification',
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        params: {},
        approvalRef: 'EACC/AI/2026/033',
      });
    });
  });

  it('keeps the Commissions tab when only routing fails', () => {
    renderView({
      result: {
        ok: true,
        data: { ...OVERVIEW, routing: { ok: false, error: { kind: 'unavailable', detail: null } } },
      },
      search: { tab: 'routing' },
    });
    expect(screen.getByText('Routing could not be loaded.')).toBeTruthy();
  });
});
