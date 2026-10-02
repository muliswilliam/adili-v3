// @vitest-environment jsdom
import { TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MOCK_CASE_IDS as CASES,
  MOCK_CLARIFICATION_IDS as K,
  mockReviewClient,
  resetReviewMock,
} from '../../server/review/mock.server';
import { CaseClarifications } from './case-clarifications';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
  }) => {
    let href = to;
    for (const [name, value] of Object.entries(params ?? {}))
      href = href.replace(`$${name}`, value);
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

const NOW_MS = Date.parse('2026-09-28T09:00:00Z');
const NOW = new Date(NOW_MS).toISOString();
const ME = 'a1b2c3d4-0000-4000-8000-000000000001';

beforeEach(() => {
  resetReviewMock(NOW_MS);
});

async function renderTab(caseId: string, subject = ME) {
  const { data } = await mockReviewClient(ME, 'Grace Wanjiru').GET('/v1/review/cases/{caseId}', {
    params: { path: { caseId } },
  });
  if (!data) throw new Error('no case');
  const onNew = vi.fn();
  render(
    <TooltipProvider>
      <CaseClarifications
        reviewCase={data.case}
        clarifications={data.clarifications}
        subject={subject}
        now={NOW}
        onNew={onNew}
      />
    </TooltipProvider>,
  );
  return onNew;
}

const newButton = () => screen.getByRole('button', { name: 'New clarification' });

describe('CaseClarifications', () => {
  it('lists the case’s clarifications, each linking to its detail', async () => {
    await renderTab(CASES.mine);
    const list = screen.getByRole('list', { name: 'Clarifications on this case' });
    const rows = within(list).getAllByRole('link');
    expect(rows).toHaveLength(7);
    const late = rows.find((row) => row.getAttribute('href')?.endsWith(K.late));
    expect(late?.textContent).toMatch(
      /CLR-TSC-2026-0000017-.*responded .* \(3 days late\)RespondedLate/,
    );
    const draft = rows.find((row) => row.getAttribute('href')?.endsWith(K.draft));
    expect(draft?.textContent).toBe('Draft (no reference yet)Not sent · 1 itemDraft');
  });

  it('opens the composer for the officer holding the case while the window is open', async () => {
    const onNew = await renderTab(CASES.mine);
    expect(screen.getByText(/^Window open until /)).toBeTruthy();
    fireEvent.click(newButton());
    expect(onNew).toHaveBeenCalled();
  });

  it('disables New clarification once the window has closed, and says when', async () => {
    await renderTab(CASES.windowClosed);
    expect(newButton().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/^The clarification window closed on /)).toBeTruthy();
  });

  it('disables it for anyone but the officer holding the case', async () => {
    await renderTab(CASES.peters);
    expect(newButton().hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByText('Only Peter Mwangi, who holds this case, can issue clarifications.'),
    ).toBeTruthy();
  });

  it('says when there are none yet', async () => {
    const { data } = await mockReviewClient(ME, 'Grace').GET('/v1/review/cases/{caseId}', {
      params: { path: { caseId: CASES.mine } },
    });
    if (!data) throw new Error('no case');
    render(
      <TooltipProvider>
        <CaseClarifications
          reviewCase={data.case}
          clarifications={[]}
          subject={ME}
          now={NOW}
          onNew={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText('No clarifications yet')).toBeTruthy();
    expect(screen.getByText('None issued for this case.')).toBeTruthy();
  });
});
