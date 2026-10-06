import { SUPERVISOR } from '@adili/roles';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  approveDetermination,
  decisionLetterLink,
  determinationLetter,
  proposeDetermination,
  returnDetermination,
  withdrawDetermination,
} from './determinations.server';
import { loadCaseView } from './review-case.server';
import {
  MOCK_CASE_IDS as CASES,
  MOCK_DETERMINATION_IDS as D,
  mockReviewClient,
  resetReviewMock,
} from './review/mock.server';
import type { Assignee } from './review/types';

const NOW_MS = Date.parse('2026-10-02T09:00:00Z');
const ME: Assignee = { subject: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Faith Achieng' };
const SUP: Assignee = { subject: 'a1b2c3d4-0000-4000-8000-000000000002', name: 'Samuel Njoroge' };

const reviewer = (officer: Assignee = ME) => mockReviewClient(officer.subject, officer.name);
const supervisor = (officer: Assignee = SUP) =>
  mockReviewClient(officer.subject, officer.name, [SUPERVISOR]);

async function determinationsOf(caseId: string) {
  const result = await loadCaseView(reviewer(), caseId, ME);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data.detail.determinations;
}

const KEY = 'b7f6c2a0-0000-4000-8000-000000000001';

beforeEach(() => {
  resetReviewMock(NOW_MS);
});

describe('proposeDetermination (S1)', () => {
  it('records the assignee’s proposal, which the case then shows as awaiting approval', async () => {
    const result = await proposeDetermination(
      reviewer(),
      CASES.ready,
      { outcome: 'non-compliant', reasons: 'A directorship is left out.', furtherActionNote: null },
      KEY,
    );
    expect(result).toMatchObject({ ok: true, data: { status: 'proposed', proposer: ME } });
    const [current] = await determinationsOf(CASES.ready);
    expect(current).toMatchObject({ outcome: 'non-compliant', status: 'proposed' });
  });

  it('refuses a second proposal while one is open (409 determination-open)', async () => {
    const input = { outcome: 'compliant', reasons: 'All flags reviewed.' } as const;
    await proposeDetermination(reviewer(), CASES.ready, input, KEY);
    const again = await proposeDetermination(
      reviewer(),
      CASES.ready,
      input,
      'b7f6c2a0-0000-4000-8000-000000000002',
    );
    expect(again).toMatchObject({ ok: false, refusal: { kind: 'determination-open' } });
  });

  it('refuses while a clarification is open (409 clarification-open)', async () => {
    const result = await proposeDetermination(
      reviewer(),
      CASES.mine,
      { outcome: 'compliant', reasons: 'All flags reviewed.' },
      KEY,
    );
    expect(result).toMatchObject({ ok: false, refusal: { kind: 'clarification-open' } });
  });

  it('refuses anyone but the assignee (403 not-the-assignee)', async () => {
    const result = await proposeDetermination(
      reviewer(),
      CASES.peters,
      { outcome: 'compliant', reasons: 'All flags reviewed.' },
      KEY,
    );
    expect(result).toMatchObject({ ok: false, refusal: { kind: 'not-the-assignee' } });
  });
});

describe('approveDetermination (S1)', () => {
  it('refuses the proposer (403 separation-of-duties, proposer)', async () => {
    await proposeDetermination(
      reviewer(),
      CASES.ready,
      { outcome: 'compliant', reasons: 'All flags reviewed.' },
      KEY,
    );
    const [proposed] = await determinationsOf(CASES.ready);
    const result = await approveDetermination(
      mockReviewClient(ME.subject, ME.name, [SUPERVISOR]),
      proposed?.id ?? '',
      KEY,
    );
    expect(result).toMatchObject({
      ok: false,
      refusal: { kind: 'separation-of-duties', reason: 'proposer' },
    });
  });

  it('refuses a supervisor who reviewed the case (reviewer-of-record)', async () => {
    const result = await approveDetermination(
      mockReviewClient(ME.subject, ME.name, [SUPERVISOR]),
      D.awaitingOfRecord,
      KEY,
    );
    expect(result).toMatchObject({
      ok: false,
      refusal: { kind: 'separation-of-duties', reason: 'reviewer-of-record' },
    });
  });

  it('refuses another reviewer (403 supervisor-required)', async () => {
    const result = await approveDetermination(reviewer(SUP), D.peters, KEY);
    expect(result).toMatchObject({ ok: false, refusal: { kind: 'supervisor-required' } });
  });

  it('lets another supervisor approve: a CMP reference, the letter, the case determined', async () => {
    const result = await approveDetermination(supervisor(), D.peters, KEY);
    expect(result).toMatchObject({
      ok: true,
      data: { status: 'approved', approver: SUP, letterAvailable: true },
    });
    expect(result.ok && result.data.reference).toMatch(/^CMP-TSC-\d{4}-\d{7}-[A-Z0-9]$/);
    const view = await loadCaseView(reviewer(), CASES.peters, ME);
    expect(view.ok && view.data.detail.case.status).toBe('determined');
  });

  it('says when it was decided already (409 not-proposed)', async () => {
    await approveDetermination(supervisor(), D.peters, KEY);
    const again = await approveDetermination(
      mockReviewClient('someone-else', 'Joseph Mutua', [SUPERVISOR]),
      D.peters,
      'b7f6c2a0-0000-4000-8000-000000000003',
    );
    expect(again).toMatchObject({ ok: false, refusal: { kind: 'not-proposed' } });
  });
});

describe('returnDetermination and withdrawDetermination (S2)', () => {
  it('returns a proposal with the supervisor’s reason', async () => {
    const result = await returnDetermination(
      supervisor(),
      D.peters,
      'Say how the HR letter applies.',
    );
    expect(result).toMatchObject({
      ok: true,
      data: { status: 'returned', returnedBy: SUP, returnReason: 'Say how the HR letter applies.' },
    });
  });

  it('lets the proposer withdraw while proposed, and a revision follow a return', async () => {
    const [returned] = await determinationsOf(CASES.returned);
    expect(returned?.status).toBe('returned');
    const revised = await proposeDetermination(
      reviewer(),
      CASES.returned,
      { outcome: 'compliant', reasons: 'The valuation report VR-2291 explains the change.' },
      KEY,
    );
    expect(revised).toMatchObject({ ok: true, data: { status: 'proposed' } });
    const withdrawn = await withdrawDetermination(reviewer(), revised.ok ? revised.data.id : '');
    expect(withdrawn).toMatchObject({ ok: true, data: { status: 'withdrawn' } });
  });

  it('refuses a withdrawal by anyone but the proposer (403 not-the-proposer)', async () => {
    const result = await withdrawDetermination(reviewer(), D.peters);
    expect(result).toMatchObject({ ok: false, refusal: { kind: 'not-the-proposer' } });
  });
});

describe('decisionLetterLink', () => {
  it('links the letter through review, which asks documents for the Commission (#507)', async () => {
    const result = await decisionLetterLink(reviewer(), D.determined);
    expect(result).toMatchObject({
      ok: true,
      data: { downloadUrl: expect.stringMatching(/^\/api\/mock-files\//) as string },
    });
  });

  it('passes on review’s 409 for a determination that is not approved', async () => {
    const result = await decisionLetterLink(reviewer(), D.peters);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, code: 'not-approved' } },
    });
  });
});

describe('determinationLetter', () => {
  it('names the approved determination’s letter document', async () => {
    const result = await determinationLetter(reviewer(), D.determined);
    expect(result).toMatchObject({ ok: true, data: { documentId: expect.any(String) as string } });
  });
});
