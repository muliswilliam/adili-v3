import { describe, expect, it } from 'vitest';

import { rosterNavCounts } from './nav-counts';

describe('rosterNavCounts', () => {
  it('counts flagged officers on the Roster entry', () => {
    expect(rosterNavCounts({ flagged: 3 })).toEqual({
      '/roster': { count: 3, label: '3 flagged' },
    });
  });

  it('shows nothing when nobody is flagged or the summary is unknown', () => {
    expect(rosterNavCounts({ flagged: 0 })).toEqual({});
    expect(rosterNavCounts(null)).toEqual({});
  });
});
