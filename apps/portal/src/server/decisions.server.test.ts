import createClient from 'openapi-fetch';
import { beforeEach, describe, expect, it } from 'vitest';

import { decisionLetter, loadMyDecisions } from './decisions.server';
import {
  failNextDecisionLetter,
  MOCK_DECISION_IDS as D,
  mockReviewFetch,
  resetReviewMock,
} from './review/mock.server';
import type { paths } from './review/schema.gen';

const NOW = Date.parse('2026-09-28T09:00:00Z');

const client = () => createClient<paths>({ baseUrl: 'http://review.test', fetch: mockReviewFetch });

beforeEach(() => {
  resetReviewMock(NOW, { letterIssueMs: 0 });
});

describe('loadMyDecisions (S17)', () => {
  it('lists the declarant’s decisions, newest first', async () => {
    const result = await loadMyDecisions(client());
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.decisions.map((each) => [each.outcome, each.declarationReference])).toEqual([
      ['non-compliant', 'DCB-TSC-2024-0001207-3'],
      ['compliant-no-issues', 'DCB-TSC-2022-0000815-M'],
    ]);
    expect(result.decisions[0]).toMatchObject({
      commission: { name: 'Teachers Service Commission' },
      letterAvailable: true,
    });
    expect(result.decisions[0]?.reference).toMatch(/^CMP-TSC-2024-\d{7}-[A-Z0-9]$/);
  });
});

describe('decisionLetter (S17)', () => {
  it('links the letter for download', async () => {
    const result = await decisionLetter(client(), D.nonCompliant);
    expect(result).toEqual({
      status: 'ok',
      downloadUrl: expect.stringMatching(/^\/api\/mock-letters\//) as string,
    });
  });

  it('issues a bulk closure’s letter on its first request', async () => {
    const before = await loadMyDecisions(client());
    expect(before.status === 'ok' && before.decisions[1]?.letterAvailable).toBe(false);
    expect(await decisionLetter(client(), D.noIssues)).toMatchObject({ status: 'ok' });
    const after = await loadMyDecisions(client());
    expect(after.status === 'ok' && after.decisions[1]?.letterAvailable).toBe(true);
  });

  it('says when the letter could not be prepared', async () => {
    failNextDecisionLetter();
    expect(await decisionLetter(client(), D.noIssues)).toEqual({ status: 'unavailable' });
  });

  it('reads another declarant’s decision as missing', async () => {
    expect(await decisionLetter(client(), '0199a000-0000-7000-8000-0000000000ff')).toEqual({
      status: 'not-found',
    });
  });
});
