// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { act, fireEvent, render as renderInto, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import createClient from 'openapi-fetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MyDecisionsLoad } from '../../server/decisions';
import { decisionLetter, loadMyDecisions } from '../../server/decisions.server';
import {
  failNextDecisionLetter,
  mockReviewFetch,
  resetReviewMock,
} from '../../server/review/mock.server';
import type { paths } from '../../server/review/schema.gen';
import type { DeclarantDecision } from '../../server/review/types';
import { DecisionsCard, DecisionsSection } from './decisions-card';

const render = (ui: ReactNode) => renderInto(<ToastProvider>{ui}</ToastProvider>);

const download = vi.fn();
vi.mock('../download', () => ({
  downloadFrom: (url: string) => {
    download(url);
  },
}));

const client = () => createClient<paths>({ baseUrl: 'http://review.test', fetch: mockReviewFetch });
const loadLetter = (id: string) => decisionLetter(client(), id);

async function decisions(): Promise<DeclarantDecision[]> {
  const result = await loadMyDecisions(client());
  if (result.status !== 'ok') throw new Error('decisions');
  return result.decisions;
}

const row = (reference: string) => {
  const item = screen.getByText(reference).closest('li');
  if (!item) throw new Error(reference);
  return item;
};

beforeEach(() => {
  resetReviewMock(Date.parse('2026-09-28T09:00:00Z'), { letterIssueMs: 20 });
  download.mockClear();
});

describe('DecisionsCard (spec 08 FE-7, S17)', () => {
  it('shows each decision: outcome, CMP reference, what it means, when and on what', async () => {
    render(<DecisionsCard decisions={await decisions()} loadLetter={loadLetter} />);
    const nonCompliant = row('CMP-TSC-2024-0004102-U');
    expect(within(nonCompliant).getByText('Non-compliant')).toBeTruthy();
    expect(
      within(nonCompliant).getByText(
        'Your Commission may take administrative action. Check Notices.',
      ),
    ).toBeTruthy();
    expect(within(nonCompliant).getByText(/^Decided .* · Biennial declaration$/)).toBeTruthy();
    const noIssues = row('CMP-TSC-2023-0118204-M');
    expect(within(noIssues).getByText('Compliant: no issues identified')).toBeTruthy();
    expect(
      within(noIssues).getByText('No issues were found. You do not need to do anything.'),
    ).toBeTruthy();
  });

  it('downloads the letter, preparing a bulk closure’s on first request', async () => {
    render(<DecisionsCard decisions={await decisions()} loadLetter={loadLetter} />);
    const noIssues = row('CMP-TSC-2023-0118204-M');
    fireEvent.click(
      within(noIssues).getByRole('button', {
        name: 'Download decision letter CMP-TSC-2023-0118204-M',
      }),
    );
    expect(await within(noIssues).findByText('Preparing…')).toBeTruthy();
    await vi.waitFor(() => {
      expect(download).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/mock-letters\//));
    });
    expect(await within(noIssues).findByText('Download decision letter')).toBeTruthy();
  });

  it('says when the letter could not be prepared, and lets the declarant try again', async () => {
    failNextDecisionLetter();
    render(<DecisionsCard decisions={await decisions()} loadLetter={loadLetter} />);
    const noIssues = row('CMP-TSC-2023-0118204-M');
    const button = within(noIssues).getByRole('button', {
      name: 'Download decision letter CMP-TSC-2023-0118204-M',
    });
    fireEvent.click(button);
    expect(
      await within(noIssues).findByText(
        'We could not prepare your letter. Try again in a few minutes.',
      ),
    ).toBeTruthy();
    expect(download).not.toHaveBeenCalled();
    fireEvent.click(button);
    await vi.waitFor(() => {
      expect(download).toHaveBeenCalledTimes(1);
    });
  });

  it('asks the declarant to sign in again when the session has ended', async () => {
    render(
      <DecisionsCard
        decisions={await decisions()}
        loadLetter={() => Promise.resolve({ status: 'unauthenticated' })}
      />,
    );
    const nonCompliant = row('CMP-TSC-2024-0004102-U');
    fireEvent.click(
      within(nonCompliant).getByRole('button', {
        name: 'Download decision letter CMP-TSC-2024-0004102-U',
      }),
    );
    expect(
      await within(nonCompliant).findByText(
        'Your session has ended. Sign in again to download your letter.',
      ),
    ).toBeTruthy();
  });

  it.each<[string, MyDecisionsLoad]>([
    ['no decisions yet', { status: 'ok', decisions: [] }],
    ['the list could not load', { status: 'unavailable' }],
    ['signed out', { status: 'unauthenticated' }],
  ])('shows nothing on Home when %s', async (_, load) => {
    const { container } = render(
      <DecisionsSection decisions={Promise.resolve(load)} loadLetter={loadLetter} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText('Decisions')).toBeNull();
    expect(container.querySelector('section')).toBeNull();
  });
});
