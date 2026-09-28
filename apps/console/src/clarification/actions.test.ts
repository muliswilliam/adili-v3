import { describe, expect, it } from 'vitest';

import { clarificationActions } from './actions';

describe('clarificationActions', () => {
  it('lets the assignee resolve or follow up once answered, and withdraw before', () => {
    const at = (status: Parameters<typeof clarificationActions>[0]['status']) =>
      clarificationActions({ status, mine: true, windowOpen: true });
    expect(at('issued')).toEqual({ resolve: false, followUp: 'hidden', withdraw: true });
    expect(at('overdue')).toEqual({ resolve: false, followUp: 'hidden', withdraw: true });
    expect(at('responded')).toEqual({ resolve: true, followUp: 'enabled', withdraw: false });
    expect(at('resolved')).toEqual({ resolve: false, followUp: 'hidden', withdraw: false });
    expect(at('withdrawn')).toEqual({ resolve: false, followUp: 'hidden', withdraw: false });
    expect(at('draft')).toEqual({ resolve: false, followUp: 'hidden', withdraw: false });
  });

  it('offers nothing to someone who does not hold the case', () => {
    expect(clarificationActions({ status: 'responded', mine: false, windowOpen: true })).toEqual({
      resolve: false,
      followUp: 'hidden',
      withdraw: false,
    });
  });

  it('disables a follow-up once the six-month window has closed', () => {
    expect(
      clarificationActions({ status: 'responded', mine: true, windowOpen: false }).followUp,
    ).toBe('disabled');
  });
});
