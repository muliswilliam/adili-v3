import { describe, expect, it } from 'vitest';

import type { RosterImport } from '../../server/directory/client';
import { nextSteps } from './next-steps';

const NOW = new Date('2026-09-28T09:00:00Z');

const COUNTS = {
  accepted: 10,
  created: 10,
  updated: 0,
  unchanged: 0,
  rejected: 3,
  flaggedAbsent: 0,
  exitsRecorded: 0,
};

const fileImport = (overrides: Partial<RosterImport> = {}): RosterImport =>
  ({
    id: '0199a0b4-0000-7000-8000-0000000000aa',
    channel: 'file',
    state: 'completed',
    startedAt: '2026-09-20T08:00:00Z',
    rowsRetainedUntil: '2026-10-20T08:00:00Z',
    counts: COUNTS,
    ...overrides,
  }) as RosterImport;

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

  it('asks to fix the rejected rows of the latest import, a file, after flagged officers', () => {
    const lastImport = fileImport();
    expect(
      nextSteps({ flagged: 2, readOnly: false, credential: 'active', lastImport, now: NOW }),
    ).toEqual([
      { kind: 'review-flagged', count: 2 },
      { kind: 'fix-rejected', importId: lastImport.id, count: 3, startedAt: lastImport.startedAt },
    ]);
  });

  it.each([
    ['none were rejected', fileImport({ counts: { ...COUNTS, rejected: 0 } })],
    ['an HR system sent it', fileImport({ channel: 'api' })],
    ['it failed', fileImport({ state: 'failed' })],
    ['its rows are purged', fileImport({ rowsRetainedUntil: '2026-09-27T08:00:00Z' })],
  ])('does not ask to fix rejected rows when %s', (_case, lastImport) => {
    expect(
      nextSteps({ flagged: 0, readOnly: false, credential: 'active', lastImport, now: NOW }),
    ).toEqual([{ kind: 'find-someone' }]);
  });

  it('does not ask a commission admin to fix rejected rows', () => {
    expect(
      nextSteps({
        flagged: 0,
        readOnly: true,
        credential: null,
        lastImport: fileImport(),
        now: NOW,
      }),
    ).toEqual([{ kind: 'find-someone' }]);
  });
});
