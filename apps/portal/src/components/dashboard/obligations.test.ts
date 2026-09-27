import { describe, expect, it } from 'vitest';

import { CLOSED_REASONS, startAvailability } from './obligations';

describe('startAvailability (S20)', () => {
  it('lets the declarant start due, overdue and upcoming obligations', () => {
    for (const status of ['due', 'overdue', 'upcoming'] as const) {
      expect(startAvailability({ id: 'o-1', status }, [])).toEqual({ kind: 'start' });
    }
  });

  it('continues an existing draft for the obligation', () => {
    expect(
      startAvailability({ id: 'o-1', status: 'due' }, [
        { id: 'd-0', obligationId: 'o-2', status: 'draft' },
        { id: 'd-1', obligationId: 'o-1', status: 'draft' },
      ]),
    ).toEqual({ kind: 'continue', declarationId: 'd-1' });
  });

  it('disables filed and cancelled obligations with a reason', () => {
    expect(startAvailability({ id: 'o-1', status: 'filed' }, [])).toEqual({
      kind: 'closed',
      reason: CLOSED_REASONS.filed,
    });
    expect(startAvailability({ id: 'o-1', status: 'cancelled' }, [])).toEqual({
      kind: 'closed',
      reason: CLOSED_REASONS.cancelled,
    });
  });
});
