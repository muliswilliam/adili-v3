import { describe, expect, it } from 'vitest';

import type { ProblemDetails } from '../../server/directory/types';
import { failureText, messages } from './messages';

const problem = (status: number, detail?: string): ProblemDetails => ({
  type: 'about:blank',
  title: 'Problem',
  status,
  ...(detail === undefined ? {} : { detail }),
});

describe('failureText', () => {
  it('shows the problem detail when the directory gives one, whatever the failure', () => {
    for (const kind of ['unavailable', 'invalid', 'conflict', 'forbidden', 'not-found'] as const) {
      expect(failureText({ kind, problem: problem(500, 'Directory is read-only today.') })).toBe(
        'Directory is read-only today.',
      );
    }
  });

  it('says the directory did not respond only when it is unavailable', () => {
    expect(failureText({ kind: 'unavailable', problem: null })).toBe(
      'The directory service did not respond.',
    );
    expect(failureText({ kind: 'unavailable', problem: problem(502, '  ') })).toBe(
      'The directory service did not respond.',
    );
  });

  it('describes rejected and conflicting requests accurately', () => {
    const invalid = failureText({ kind: 'invalid', problem: problem(400) });
    const conflict = failureText({ kind: 'conflict', problem: null });
    expect(invalid).toBe('The directory service could not handle the request.');
    expect(conflict).toBe('The directory service reported a conflict with the current data.');
    expect([invalid, conflict]).not.toContain('The directory service did not respond.');
  });

  it('uses the forbidden copy for a 403 without detail', () => {
    expect(failureText({ kind: 'forbidden', problem: null })).toBe(messages.forbidden);
  });
});

describe('messages.count', () => {
  it('reads "N Commissions", filtered or not', () => {
    expect(messages.count(12, { more: false })).toBe('12 Commissions');
    expect(messages.count(1, { more: false })).toBe('1 Commission');
    expect(messages.count(50, { more: true })).toBe('50+ Commissions');
  });
});

describe('messages.detail.policyVersionValue', () => {
  it('uses the spec copy for version 1 and invents nothing for later versions', () => {
    expect(messages.detail.policyVersionValue(1)).toBe('Version 1, platform defaults');
    expect(messages.detail.policyVersionValue(2)).toBe('Version 2');
  });
});
