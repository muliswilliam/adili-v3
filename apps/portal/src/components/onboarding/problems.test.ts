import { describe, expect, it } from 'vitest';

import type { OnboardingProblemCode } from '../../server/directory/types';
import { contractEnum } from '../../test/contract';
import { minutesFrom, PROBLEM_COPY, problemMessage } from './problems';

// S24: the copy table covers every problem code in the contract.
describe('PROBLEM_COPY', () => {
  const codes = contractEnum('OnboardingProblem') as OnboardingProblemCode[];

  it('has copy for exactly the codes in the contract', () => {
    expect(codes.length).toBeGreaterThan(0);
    expect(Object.keys(PROBLEM_COPY).sort()).toEqual([...codes].sort());
  });

  it.each(codes)('reads %s as a complete sentence with or without context', (code) => {
    for (const message of [
      problemMessage(code),
      problemMessage(code, { commissionName: 'TSC', attemptsLeft: 2, retryAfterSeconds: 30 }),
    ]) {
      expect(message).toMatch(/\.$/);
      expect(message).not.toContain('undefined');
    }
  });

  it('names the Commission when a record does not match', () => {
    expect(problemMessage('no-match', { commissionName: 'Teachers Service Commission' })).toContain(
      "Teachers Service Commission's roster",
    );
  });

  it('states the rate-limit wait in whole minutes', () => {
    expect(problemMessage('rate-limit-exceeded', { retryAfterSeconds: 61 })).toBe(
      'Too many attempts. Try again in 2 minutes.',
    );
    expect(problemMessage('rate-limit-exceeded', { retryAfterSeconds: 20 })).toBe(
      'Too many attempts. Try again in 1 minute.',
    );
    expect(minutesFrom(0)).toBe(1);
  });
});
