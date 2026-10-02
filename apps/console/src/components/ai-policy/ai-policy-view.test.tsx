// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { GateRule, TenantUsage } from '../../server/ai-gateway/types';
import type { AiPolicyOverview, AiTenantRow } from '../../server/ai-policy.server';
import type { ServiceResult } from '../../server/service-call';
import { AiPolicyView } from './ai-policy-view';
import type { SaveBudget } from './budget-dialog';
import type { SaveGate } from './gate-dialog';

const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }));

const allowSynthetic: GateRule = {
  dataClass: 'synthetic',
  providerClass: 'external',
  allowed: true,
  approvalRef: 'EACC/AI/2026/014',
  changedBy: 'Amina Wanjiru',
  changedAt: '2026-09-01T08:40:00Z',
};

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
  rules: [allowSynthetic],
  usage: usage(1_926_400, 3_000_000, { perMinute: 120 }),
};
const JSC: AiTenantRow = {
  slug: 'jsc',
  name: 'Judicial Service Commission',
  rules: [{ ...allowSynthetic, approvalRef: 'EACC/AI/2026/019' }],
  usage: usage(862_300, 1_000_000),
};
const NAIROBI: AiTenantRow = {
  slug: 'cpsbnairobicity',
  name: 'Nairobi City County Public Service Board',
  rules: [{ ...allowSynthetic, approvalRef: 'EACC/AI/2026/021' }],
  usage: usage(1_500_000, 1_500_000),
};
const TSC: AiTenantRow = {
  slug: 'tsc',
  name: 'Teachers Service Commission',
  rules: [],
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
        model: 'claude-opus-5',
        params: { temperature: 0, maxTokens: 3_000, timeoutMs: 45_000 },
      },
      {
        tenant: 'psc',
        task: 'draft-clarification',
        provider: 'anthropic',
        model: 'claude-opus-5',
        params: { temperature: 0.2, maxTokens: 3_000, timeoutMs: 10_000 },
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

  it('says a Commission without a policy is blocked by default', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Teachers Service Commission' }));
    const drawer = within(screen.getByRole('dialog', { name: 'Teachers Service Commission' }));
    expect(drawer.getByText('Not enabled')).toBeTruthy();
    expect(drawer.getByText('Blocked for every data class')).toBeTruthy();
    expect(drawer.getByText('No changes. External providers are blocked by default.')).toBeTruthy();
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

  it('says how much was saved when a later change fails', async () => {
    const saveGate = vi.fn<SaveGate>().mockResolvedValue({
      ok: false,
      error: { kind: 'unavailable', detail: null },
      saved: 1,
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
    expect(
      screen.getByText(
        '1 of 2 changes were saved before the error. The Commission now shows what was saved.',
      ),
    ).toBeTruthy();
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
  it('lists task, scope, provider, model and parameters, read only', () => {
    renderView({ search: { tab: 'routing' } });
    expect(screen.getByText('Set in configuration')).toBeTruthy();
    const table = within(
      screen.getByRole('table', { name: 'Routing: task to provider and model' }),
    );
    expect(table.getByText('explain-flags')).toBeTruthy();
    expect(table.getByText('All Commissions')).toBeTruthy();
    // A Commission's override names it.
    expect(table.getByText('Public Service Commission')).toBeTruthy();
    expect(table.getAllByText('Anthropic')).toHaveLength(2);
    expect(table.getByText('45 s')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
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
