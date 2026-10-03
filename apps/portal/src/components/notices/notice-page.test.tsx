// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { respondToMyNotice } from '../../server/notices';
import { mockNotice, resetReviewMock } from '../../server/review/mock.server';
import { MOCK_NOTICE_IDS as IDS } from '../../server/review/notices-mock.server';
import type { DeclarantNotice } from '../../server/review/types';
import { invalidate } from '../declaration/testing-mocks';
import { NoticePage } from './notice-page';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);
vi.mock('../../server/notices', () => ({
  respondToMyNotice: vi.fn(),
  getMyNotices: vi.fn(),
}));
vi.mock('../../server/documents/uploads', () => ({
  createAttachmentUpload: vi.fn(),
  completeAttachmentUpload: vi.fn(),
  getAttachmentUpload: vi.fn(),
}));

const respondMock = vi.mocked(respondToMyNotice);

const NOW_MS = Date.parse('2026-09-28T09:00:00Z');
const NOW = new Date(NOW_MS).toISOString();

function fixture(id: string): DeclarantNotice {
  const found = mockNotice(id);
  if (!found) throw new Error(id);
  return found;
}

function all(): DeclarantNotice[] {
  return Object.values(IDS).map(fixture);
}

function renderPage(id: string) {
  render(
    <ToastProvider>
      <NoticePage notice={fixture(id)} all={all()} now={NOW} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  resetReviewMock(NOW_MS);
  respondMock.mockReset();
  invalidate.mockClear();
});
afterEach(cleanup);

describe('NoticePage (S17)', () => {
  it('says what failed, by when to act and how, with the letter', () => {
    renderPage(IDS.noticeOpen);
    expect(screen.getByRole('heading', { level: 1, name: 'Notice to comply' })).toBeTruthy();
    expect(screen.getAllByText('ADM-TSC-2026-0000412-U').length).toBeGreaterThan(0);
    const banner = screen.getByText(/^Act by 7 Oct 2026 \(/).closest('[role="status"]');
    expect(banner?.textContent).toBe(
      'Act by 7 Oct 2026 (9 days left). File your biennial declaration 2026. If you do not, TSC may issue a warning.File declaration',
    );
    expect(
      screen.getByText('You did not file your biennial declaration 2026 by its due date.'),
    ).toBeTruthy();
    expect(screen.getByText('9 days left')).toBeTruthy();
    expect(screen.getByText('Act by 7 Oct 2026 · day 5 of 14')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Download PDF/ }).getAttribute('href')).toBe(
      `/api/mock-letters/${IDS.noticeOpen}`,
    );
  });

  it('a warning names its clarification, when it was due, and the next consequence', () => {
    renderPage(IDS.warning);
    expect(
      screen.getByText(
        'You did not respond to clarification CLR-TSC-2026-0000519-L by 9 Sep 2026, when your response was due.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/^Act by 10 Oct 2026 \(/).closest('[role="status"]')?.textContent,
    ).toContain(
      'Respond to clarification CLR-TSC-2026-0000519-L. If you do not, TSC may stop your salary.',
    );
  });

  it('sends one response after confirming (S9)', async () => {
    const responded = {
      ...fixture(IDS.noticeOpen),
      status: 'responded' as const,
      response: { text: 'I was in hospital.', attachments: [], submittedAt: NOW },
    };
    respondMock.mockResolvedValue({ status: 'responded', notice: responded });
    renderPage(IDS.noticeOpen);

    fireEvent.click(screen.getByRole('button', { name: 'Submit response' }));
    expect(screen.getByText('Write your response before submitting.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.change(screen.getByLabelText('Your response'), {
      target: { value: 'I was in hospital.' },
    });
    expect(screen.getByText('18 / 4,000')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Submit response' }));
    const dialog = screen.getByRole('dialog', { name: 'Submit your response?' });
    expect(
      within(dialog).getByText(
        'This does not stop the notice to comply. To comply, file your biennial declaration 2026.',
      ),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Submit response' }));
      await Promise.resolve();
    });
    expect(respondMock).toHaveBeenCalledWith({
      data: {
        actionId: IDS.noticeOpen,
        idempotencyKey: expect.any(String) as string,
        response: { text: 'I was in hospital.', attachments: [] },
      },
    });
    expect(screen.queryByLabelText('Your response')).toBeNull();
    expect(screen.getByText('I was in hospital.')).toBeTruthy();
    expect(screen.getByText('Your response is on record.')).toBeTruthy();
  });

  it('keeps the form and says so when the response did not go', async () => {
    respondMock.mockResolvedValue({ status: 'unavailable' });
    renderPage(IDS.noticeOpen);
    fireEvent.change(screen.getByLabelText('Your response'), { target: { value: 'Text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit response' }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit response' }),
      );
      await Promise.resolve();
    });
    expect(
      screen.getByText('Your response was not sent. Check your connection and try again.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Your response')).toBeTruthy();
  });

  it('shows a response already sent, and no form', () => {
    renderPage(IDS.noticeResponded);
    expect(screen.queryByLabelText('Your response')).toBeNull();
    expect(screen.getByText(/I was admitted at Moi Teaching and Referral Hospital/)).toBeTruthy();
    expect(screen.getByText('MTRH discharge summary.pdf')).toBeTruthy();
  });

  it('tells a declarant who complied that nothing more will happen', () => {
    renderPage(IDS.complied);
    expect(screen.getByText('You have complied. No further action will be taken.')).toBeTruthy();
    expect(screen.queryByLabelText('Your response')).toBeNull();
  });
});
