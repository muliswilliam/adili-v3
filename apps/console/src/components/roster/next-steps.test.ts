import { describe, expect, it } from 'vitest';

import { nextSteps } from './next-steps';

describe('nextSteps', () => {
  it('puts flagged officers first, then connecting the HR system', () => {
    expect(nextSteps({ flagged: 37, readOnly: false, credential: 'none' })).toEqual([
      { kind: 'review-flagged', count: 37 },
      { kind: 'connect-hr' },
    ]);
  });

  it('asks to connect the HR system again once the credential is revoked', () => {
    expect(nextSteps({ flagged: 0, readOnly: false, credential: 'revoked' })).toEqual([
      { kind: 'connect-hr' },
    ]);
  });

  it('does not ask a commission admin to connect the HR system', () => {
    expect(nextSteps({ flagged: 2, readOnly: true, credential: 'none' })).toEqual([
      { kind: 'review-flagged', count: 2 },
    ]);
  });

  it('does not ask when the credential state is unknown', () => {
    expect(nextSteps({ flagged: 0, readOnly: false, credential: null })).toEqual([
      { kind: 'find-someone' },
    ]);
  });

  it('offers finding someone when nothing is pending', () => {
    expect(nextSteps({ flagged: 0, readOnly: false, credential: 'active' })).toEqual([
      { kind: 'find-someone' },
    ]);
  });
});
