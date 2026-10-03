import { SUPERVISOR } from '@adili/roles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import createClient from 'openapi-fetch';

import type { paths as DocumentsPaths } from './documents/api.gen';
import {
  approveReferral,
  declineReferral,
  listReferrals,
  loadReferral,
  proposeReferral,
  referralPackageLink,
} from './referrals.server';
import {
  MOCK_CASE_IDS as CASES,
  MOCK_CLARIFICATION_IDS as CLARIFICATIONS,
  mockLetterFetch,
  mockReviewClient,
  resetReviewMock,
} from './review/mock.server';
import { MOCK_FLAG_IDS as FLAGS } from './review/copilot-mock.server';
import { MOCK_PACKAGE_DELAY_MS, MOCK_REFERRAL_IDS as R } from './review/referrals-mock.server';
import type { Assignee, ReferralInput } from './review/types';

const NOW_MS = Date.parse('2026-10-02T09:00:00Z');
const ME: Assignee = { subject: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Faith Achieng' };
const SUP: Assignee = { subject: 'a1b2c3d4-0000-4000-8000-000000000002', name: 'Samuel Njoroge' };

const reviewer = (officer: Assignee = ME) => mockReviewClient(officer.subject, officer.name);
const supervisor = (officer: Assignee = SUP) =>
  mockReviewClient(officer.subject, officer.name, [SUPERVISOR]);
const documents = () =>
  createClient<DocumentsPaths>({ baseUrl: 'http://documents.test', fetch: mockLetterFetch });

const KEY = 'b7f6c2a0-0000-4000-8000-000000000001';
const KEY_2 = 'b7f6c2a0-0000-4000-8000-000000000002';

const ASSETS: ReferralInput = {
  grounds: 'undeclared-assets',
  narrative: 'The plot is valued 150% higher with no improvement recorded.',
  flagIds: [FLAGS.valueChange],
  clarificationIds: [CLARIFICATIONS.late],
};

beforeEach(() => {
  resetReviewMock(NOW_MS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('proposeReferral (S13)', () => {
  it('records the assignee’s assets referral as proposed, with what it rests on', async () => {
    const result = await proposeReferral(reviewer(), CASES.mine, ASSETS, KEY);
    expect(result).toMatchObject({
      ok: true,
      data: {
        status: 'proposed',
        grounds: 'undeclared-assets',
        proposerKind: 'user',
        proposer: ME,
        caseId: CASES.mine,
        reference: null,
        declarantName: 'John Kennedy Otieno',
        sources: { flagIds: [FLAGS.valueChange], clarificationIds: [CLARIFICATIONS.late] },
      },
    });
  });

  it('refuses a second referral from the case while one waits (409 referral-open)', async () => {
    await proposeReferral(reviewer(), CASES.mine, ASSETS, KEY);
    const again = await proposeReferral(reviewer(), CASES.mine, ASSETS, KEY_2);
    expect(again).toMatchObject({ ok: false, refusal: { kind: 'referral-open' } });
  });

  it('replays the first answer for the same Idempotency-Key', async () => {
    const first = await proposeReferral(reviewer(), CASES.mine, ASSETS, KEY);
    const retry = await proposeReferral(reviewer(), CASES.mine, ASSETS, KEY);
    expect(retry).toEqual(first);
  });

  it('refuses anyone but the assignee (403 not-the-assignee)', async () => {
    const result = await proposeReferral(reviewer(), CASES.peters, ASSETS, KEY);
    expect(result).toMatchObject({ ok: false, refusal: { kind: 'not-the-assignee' } });
  });

  it('answers 400 for a flag that is not a registry or comparison flag of the case', async () => {
    const result = await proposeReferral(
      reviewer(),
      CASES.mine,
      { ...ASSETS, flagIds: [FLAGS.late] },
      KEY,
    );
    expect(result).toMatchObject({
      ok: false,
      refusal: null,
      error: { kind: 'problem', problem: { status: 400 } },
    });
  });

  it('answers 400 for a draft clarification', async () => {
    const result = await proposeReferral(
      reviewer(),
      CASES.mine,
      { ...ASSETS, clarificationIds: [CLARIFICATIONS.draft] },
      KEY,
    );
    expect(result).toMatchObject({ ok: false, error: { problem: { status: 400 } } });
  });
});

describe('listReferrals', () => {
  it('lists the Commission’s referrals newest proposal first', async () => {
    const result = await listReferrals(reviewer(), 'tsc', {});
    if (!result.ok) throw new Error('not ok');
    const proposedAt = result.data.items.map((each) => each.proposedAt);
    expect(proposedAt).toEqual([...proposedAt].sort().reverse());
    expect(result.data.items.map((each) => each.status)).toEqual(
      expect.arrayContaining(['proposed', 'sent', 'declined']),
    );
  });

  it('filters by status and pages with a cursor', async () => {
    const first = await listReferrals(reviewer(), 'tsc', { status: 'proposed', limit: 2 });
    if (!first.ok) throw new Error('not ok');
    expect(first.data.items).toHaveLength(2);
    expect(first.data.items.every((each) => each.status === 'proposed')).toBe(true);
    expect(first.data.nextCursor).not.toBeNull();
    const second = await listReferrals(reviewer(), 'tsc', {
      status: 'proposed',
      limit: 2,
      cursor: first.data.nextCursor ?? undefined,
    });
    if (!second.ok) throw new Error('not ok');
    expect(second.data.items[0]?.id).not.toBe(first.data.items[0]?.id);
  });
});

describe('loadReferral', () => {
  it('shows what a proposed referral’s package will include, by reference', async () => {
    const result = await loadReferral(supervisor(), R.twoMissedCycles);
    expect(result).toMatchObject({
      ok: true,
      data: {
        grounds: 'two-missed-cycles',
        proposerKind: 'system',
        proposer: null,
        package: null,
        evidence: expect.arrayContaining([
          { kind: 'obligation', reference: expect.any(String) },
          { kind: 'letter', reference: expect.stringMatching(/^ADM-/) },
        ]),
      },
    });
  });

  it('shows a sent referral’s manifest with a SHA-256 per item', async () => {
    const result = await loadReferral(supervisor(), R.sent);
    if (!result.ok) throw new Error('not ok');
    expect(result.data.status).toBe('sent');
    expect(result.data.reference).toMatch(/^RFL-TSC-\d{4}-\d{7}-[A-Z0-9]$/);
    expect(result.data.package?.manifest.length).toBeGreaterThan(0);
    for (const item of result.data.package?.manifest ?? []) {
      expect(item.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('reads a referral that does not exist as a 404', async () => {
    const result = await loadReferral(supervisor(), 'deadbeef-0000-4000-8000-000000000000');
    expect(result).toMatchObject({ ok: false, error: { problem: { status: 404 } } });
  });
});

describe('approveReferral (S13)', () => {
  it('allocates the RFL reference, then assembles the package and sends it', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW_MS });
    const approved = await approveReferral(supervisor(), R.fromPeter, KEY);
    expect(approved).toMatchObject({
      ok: true,
      data: {
        status: 'approved',
        approver: SUP,
        reference: expect.stringMatching(/^RFL-TSC-/),
        package: null,
        sentAt: null,
      },
    });
    vi.setSystemTime(NOW_MS + MOCK_PACKAGE_DELAY_MS);
    const sent = await loadReferral(supervisor(), R.fromPeter);
    expect(sent).toMatchObject({
      ok: true,
      data: { status: 'sent', sentAt: expect.any(String), package: { documentId: expect.any(String) } },
    });
  });

  it('refuses the proposer (403 separation-of-duties, proposer)', async () => {
    await proposeReferral(reviewer(SUP), CASES.ready, { ...ASSETS, clarificationIds: [] }, KEY);
    const list = await listReferrals(supervisor(), 'tsc', { status: 'proposed' });
    if (!list.ok) throw new Error('not ok');
    const mine = list.data.items.find((each) => each.caseId === CASES.ready);
    const result = await approveReferral(supervisor(), mine?.id ?? '', KEY_2);
    expect(result).toMatchObject({
      ok: false,
      refusal: { kind: 'separation-of-duties', reason: 'proposer' },
    });
  });

  it('refuses a reviewer of record of its case (403 separation-of-duties)', async () => {
    const result = await approveReferral(supervisor(ME), R.ofRecord, KEY);
    expect(result).toMatchObject({
      ok: false,
      refusal: { kind: 'separation-of-duties', reason: 'reviewer-of-record' },
    });
  });

  it('refuses a reviewer (403 supervisor-required)', async () => {
    const result = await approveReferral(reviewer(), R.fromPeter, KEY);
    expect(result).toMatchObject({ ok: false, refusal: { kind: 'supervisor-required' } });
  });

  it('answers 409 not-proposed once it was decided', async () => {
    const result = await approveReferral(supervisor(), R.declined, KEY);
    expect(result).toMatchObject({ ok: false, refusal: { kind: 'not-proposed' } });
  });
});

describe('declineReferral', () => {
  it('declines with the supervisor’s note; nothing is sent', async () => {
    const result = await declineReferral(supervisor(), R.fromPeter, 'Declared in an amendment.');
    expect(result).toMatchObject({
      ok: true,
      data: {
        status: 'declined',
        declinedBy: SUP,
        declineNote: 'Declared in an amendment.',
        reference: null,
        package: null,
      },
    });
  });
});

describe('referralPackageLink', () => {
  it('links to a sent referral’s evidence package through the documents service', async () => {
    const result = await referralPackageLink(supervisor(), documents(), R.sent);
    expect(result).toMatchObject({
      ok: true,
      data: { downloadUrl: expect.stringMatching(/^\/api\/mock-files\//) },
    });
  });

  it('has no link before the package is assembled', async () => {
    const result = await referralPackageLink(supervisor(), documents(), R.twoMissedCycles);
    expect(result.ok).toBe(false);
  });
});
