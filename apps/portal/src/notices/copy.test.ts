import { describe, expect, it } from 'vitest';

import { COPY, subjectName } from './copy';

describe('the notice names what failed (US18)', () => {
  it('names a declaration by its cycle and a clarification by its CLR number', () => {
    expect(subjectName({ kind: 'obligation', reference: 'biennial:2027', dueAt: null })).toBe(
      'biennial declaration 2027',
    );
    expect(subjectName({ kind: 'obligation', reference: 'initial:2026-09-07', dueAt: null })).toBe(
      'initial declaration',
    );
    expect(
      subjectName({ kind: 'clarification', reference: 'CLR-TSC-2026-0000519-L', dueAt: null }),
    ).toBe('clarification CLR-TSC-2026-0000519-L');
  });

  it('says by when the clarification response was due, from the clarification itself', () => {
    const clarification = {
      kind: 'clarification' as const,
      reference: 'CLR-TSC-2026-0000519-L',
      dueAt: '2026-09-09T09:00:00.000Z',
    };
    expect(COPY.happened(clarification)).toBe(
      'You did not respond to clarification CLR-TSC-2026-0000519-L by 9 Sep 2026, when your response was due.',
    );
    expect(COPY.todo(clarification)).toBe('Respond to clarification CLR-TSC-2026-0000519-L.');
    expect(COPY.todo({ kind: 'obligation', reference: 'biennial:2026', dueAt: null })).toBe(
      'File your biennial declaration 2026.',
    );
  });
});
