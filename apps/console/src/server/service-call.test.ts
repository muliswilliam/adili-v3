import { describe, expect, it } from 'vitest';

import {
  DECISION_REFUSAL_STATUS,
  isDecisionRefusal,
  refusalOf,
  type ServiceError,
} from './service-call';

const problem = (status: number, code: string, extra: object = {}): ServiceError => ({
  kind: 'problem',
  problem: { type: code, title: 'Refused', status, code, ...extra } as never,
});

const STATUSES = { ...DECISION_REFUSAL_STATUS, 'referral-open': 409 } as const;

describe('refusalOf', () => {
  it('reads a known code under the status the map gives it, with its reason', () => {
    expect(
      refusalOf(problem(403, 'separation-of-duties', { reason: 'proposer' }), STATUSES),
    ).toEqual({ kind: 'separation-of-duties', reason: 'proposer' });
    expect(refusalOf(problem(409, 'referral-open'), STATUSES)).toEqual({ kind: 'referral-open' });
  });

  it('is not that refusal under another status than the map gives it', () => {
    expect(refusalOf(problem(409, 'separation-of-duties'), STATUSES)).toBeNull();
    expect(refusalOf(problem(403, 'not-proposed'), STATUSES)).toBeNull();
  });

  it('is null for an unknown code, another status or no problem', () => {
    expect(refusalOf(problem(409, 'something-else'), STATUSES)).toBeNull();
    expect(refusalOf(problem(400, 'referral-open'), STATUSES)).toBeNull();
    expect(refusalOf({ kind: 'unavailable', detail: null }, STATUSES)).toBeNull();
  });
});

describe('isDecisionRefusal', () => {
  it('knows the refusals of deciding an approval, and no others', () => {
    expect(isDecisionRefusal({ kind: 'not-proposed' })).toBe(true);
    expect(isDecisionRefusal({ kind: 'supervisor-required' })).toBe(true);
    expect(isDecisionRefusal({ kind: 'referral-open' })).toBe(false);
    expect(isDecisionRefusal({ kind: 'toString' })).toBe(false);
  });
});
