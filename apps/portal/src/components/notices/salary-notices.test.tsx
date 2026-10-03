// @vitest-environment jsdom
import { formatDate, ToastProvider } from '@adili/ui';
import { cleanup, render, screen, within } from '@testing-library/react';
import createClient from 'openapi-fetch';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMyNotices } from '../../server/notices.server';
import { mockReviewFetch, resetReviewMock } from '../../server/review/mock.server';
import {
  MOCK_SALARY_NOTICE_IDS as IDS,
  type MockSalary,
} from '../../server/review/notices-mock.server';
import type { paths } from '../../server/review/schema.gen';
import type { DeclarantNotice } from '../../server/review/types';
import { NoticePage } from './notice-page';
import { NoticesView } from './notices-view';

/**
 * The declarant's salary stoppage and disciplinary referral notices (spec 08 FE-7, #208; S7,
 * S17, US 20): the salary stopped, the disciplinary referral, reinstatement on its way to
 * payroll and confirmed.
 */

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);
vi.mock('../../server/notices', () => ({ respondToMyNotice: vi.fn(), getMyNotices: vi.fn() }));
vi.mock('../../server/documents/uploads', () => ({
  createAttachmentUpload: vi.fn(),
  completeAttachmentUpload: vi.fn(),
  getAttachmentUpload: vi.fn(),
}));

const NOW_MS = Date.parse('2026-09-28T09:00:00Z');
const NOW = new Date(NOW_MS).toISOString();
const DAY = 86_400_000;
const client = createClient<paths>({ baseUrl: 'http://review.test', fetch: mockReviewFetch });

async function notices(salary: MockSalary): Promise<DeclarantNotice[]> {
  resetReviewMock(NOW_MS, { salary });
  const result = await loadMyNotices(client);
  if (result.status !== 'ok') throw new Error('notices failed');
  return result.notices;
}

async function page(salary: MockSalary, id: string) {
  const all = await notices(salary);
  const notice = all.find((each) => each.actionId === id);
  if (!notice) throw new Error(id);
  render(
    <ToastProvider>
      <NoticePage notice={notice} all={all} now={NOW} />
    </ToastProvider>,
  );
}

/** The first status banner on the page. */
function firstStatus(): HTMLElement {
  const [banner] = screen.getAllByRole('status');
  if (!banner) throw new Error('no banner');
  return banner;
}

afterEach(cleanup);

describe('a salary stoppage notice (S17, US 20)', () => {
  it('says the salary is stopped, how to comply, and the payroll instruction', async () => {
    await page('stopped', IDS.stoppage);
    expect(screen.getByRole('heading', { level: 1, name: 'Salary stoppage' })).toBeTruthy();
    const banner = firstStatus();
    expect(
      within(banner).getByText(
        'Your salary has been stopped pending compliance. It will be reinstated automatically when you comply.',
      ),
    ).toBeTruthy();
    expect(within(banner).getByText('To comply: respond to your clarification.')).toBeTruthy();
    const salary = screen.getByRole('region', { name: 'Your salary' });
    expect(within(salary).getByText('Salary stopped')).toBeTruthy();
    expect(
      within(salary).getByText(formatDate(new Date(NOW_MS - 6 * DAY).toISOString())),
    ).toBeTruthy();
    expect(within(salary).getByText('ADM-TSC-2026-0000358-0')).toBeTruthy();
    expect(within(salary).getByText('Automatic when you comply')).toBeTruthy();
  });

  it('says the reinstatement is on its way to payroll once the declarant complied (S7)', async () => {
    await page('reinstating', IDS.stoppage);
    expect(
      screen.getByText(
        'You have complied. Your salary reinstatement is being sent to payroll. We will SMS you when payroll confirms it.',
      ),
    ).toBeTruthy();
    const salary = screen.getByRole('region', { name: 'Your salary' });
    expect(within(salary).getByText('Being sent to payroll')).toBeTruthy();
  });

  it('says when payroll confirmed the reinstatement (S7)', async () => {
    await page('reinstated', IDS.stoppage);
    const confirmed = formatDate(new Date(NOW_MS - DAY).toISOString());
    const salary = screen.getByRole('region', { name: 'Your salary' });
    expect(within(salary).getByText(`Confirmed ${confirmed}`)).toBeTruthy();
  });
});

describe('a disciplinary referral notice (S10)', () => {
  it('says the Commission asked for disciplinary proceedings and the salary stays stopped', async () => {
    await page('disciplinary', IDS.disciplinary);
    expect(screen.getByRole('heading', { level: 1, name: 'Disciplinary referral' })).toBeTruthy();
    expect(screen.getByText('TSC has asked for disciplinary proceedings to start.')).toBeTruthy();
    expect(
      screen.getByText(
        'Your salary remains stopped. You can still comply: respond to your clarification.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Act by/)).toBeNull();
  });
});

describe('the Notices list with a stopped salary', () => {
  it('puts the stopped salary on top, not an act-by date', async () => {
    const all = await notices('stopped');
    render(
      <NoticesView
        result={{ status: 'ok', notices: all }}
        now={NOW}
        page={1}
        onPage={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const banner = firstStatus();
    expect(
      within(banner).getByText(
        'Your salary has been stopped pending compliance. It will be reinstated automatically when you comply.',
      ),
    ).toBeTruthy();
  });
});
