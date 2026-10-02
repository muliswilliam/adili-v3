import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import {
  cycleOptions,
  hasQueueFilters,
  queueQuery,
  type QueueSearch,
  queueSearchSchema,
  tilePressed,
  toggleSwitch,
  toggleTile,
  withFilter,
} from './query';

/** The filters after a trip through the address bar: written by the router, read back by the page. */
const roundTrip = (search: QueueSearch) =>
  queueSearchSchema.parse(defaultParseSearch(defaultStringifySearch(search)));

const SUBJECT = 'a1b2c3d4-0000-4000-8000-000000000002';

describe('S19 review queue filters in the URL', () => {
  it.each<[string, QueueSearch]>([
    [
      'every filter',
      {
        search: 'DCI-PSC-2026',
        status: 'awaiting-clarification',
        band: 'high',
        type: 'initial',
        cycle: 2026,
        assignee: 'mine',
        late: true,
        openClarification: true,
        registryUnavailable: true,
      },
    ],
    ['high and late (the spec example)', { band: 'high', late: true }],
    ['a supervisor picking a reviewer', { assignee: SUBJECT }],
    ['unassigned only', { assignee: 'unassigned', status: 'unassigned' }],
    ['registry unavailable only', { registryUnavailable: true }],
    ['a file number of digits', { search: '2019' }],
    ['a name fragment', { search: 'Wanjiku' }],
    ['nothing', {}],
  ])('round-trips %s', (_, search) => {
    expect(roundTrip(search)).toEqual(search);
  });

  it('writes only the filters that are set', () => {
    expect(defaultStringifySearch(withFilter({}, 'band', 'high'))).toBe('?band=high');
    expect(defaultStringifySearch(toggleSwitch({ band: 'high' }, 'late'))).toBe(
      '?band=high&late=true',
    );
    expect(defaultStringifySearch(toggleSwitch({ late: true }, 'late'))).toBe('');
    expect(defaultStringifySearch(withFilter({ type: 'final' }, 'type', undefined))).toBe('');
  });

  it('reads a hand-typed URL: digits as a search, 1 as on, a year as text', () => {
    expect(
      queueSearchSchema.parse(defaultParseSearch('?search=2019&late=1&cycle=2025&band=high')),
    ).toEqual({ search: '2019', late: true, cycle: 2025, band: 'high' });
    expect(queueSearchSchema.parse({ registryUnavailable: 'true', search: ' psc/2009 ' })).toEqual({
      registryUnavailable: true,
      search: 'psc/2009',
    });
  });

  it('leaves out switches that are off and anyone, the default assignee', () => {
    expect(
      queueSearchSchema.parse({
        late: false,
        openClarification: 'false',
        registryUnavailable: 0,
        assignee: 'any',
      }),
    ).toEqual({});
  });

  it('drops values it does not know instead of failing the page', () => {
    expect(
      queueSearchSchema.parse({
        status: 'determined',
        band: 'urgent',
        type: 'annual',
        cycle: 'next year',
        assignee: 'x'.repeat(201),
        late: 'maybe',
        search: 'x'.repeat(101),
      }),
    ).toEqual({});
    expect(queueSearchSchema.parse({ cycle: 1999 })).toEqual({});
  });

  it('keeps no page in the URL', () => {
    expect(queueSearchSchema.parse({ cursor: 'abc', band: 'low' })).toEqual({ band: 'low' });
  });

  it('leaves blank searches out', () => {
    expect(queueSearchSchema.parse({ search: '   ' })).toEqual({});
  });

  it('knows when any filter is set', () => {
    expect(hasQueueFilters({})).toBe(false);
    expect(hasQueueFilters({ search: 'Kamau' })).toBe(true);
    expect(hasQueueFilters({ registryUnavailable: true })).toBe(true);
  });
});

describe('summary tiles as filters', () => {
  it('shows a tile pressed when its filter alone is set, a search aside', () => {
    expect(tilePressed({ status: 'unassigned' }, 'unassigned')).toBe(true);
    expect(tilePressed({ status: 'unassigned', search: 'Kamau' }, 'unassigned')).toBe(true);
    expect(tilePressed({ status: 'unassigned', band: 'high' }, 'unassigned')).toBe(false);
    expect(tilePressed({ assignee: 'mine' }, 'mine')).toBe(true);
    expect(tilePressed({}, 'mine')).toBe(false);
  });

  it('switches to the tile, keeping the search, and back to everything', () => {
    const filtered: QueueSearch = { band: 'high', late: true, search: 'Kamau' };
    const mine = toggleTile(filtered, 'mine');
    expect(mine).toEqual({ search: 'Kamau', assignee: 'mine' });
    expect(toggleTile(mine, 'mine')).toEqual({ search: 'Kamau' });
    expect(toggleTile(mine, 'ready-for-determination')).toEqual({
      search: 'Kamau',
      status: 'ready-for-determination',
    });
  });
});

describe('queueQuery', () => {
  it("sends the review service's query: switches as true, off filters left out", () => {
    expect(
      queueQuery(
        {
          search: ' DCI ',
          status: 'clarified',
          band: 'medium',
          type: 'biennial',
          cycle: 2025,
          assignee: SUBJECT,
          late: true,
          openClarification: true,
          registryUnavailable: true,
        },
        { cursor: 'next', limit: 50 },
      ),
    ).toEqual({
      search: 'DCI',
      status: 'clarified',
      band: 'medium',
      type: 'biennial',
      cycle: 2025,
      assignee: SUBJECT,
      late: 'true',
      openClarification: 'true',
      registryUnavailable: 'true',
      cursor: 'next',
      limit: 50,
    });
    expect(queueQuery({})).toEqual({});
  });
});

describe('cycleOptions', () => {
  const NOW = Date.parse('2026-10-02T09:00:00Z');

  it('offers this year and the two before, newest first', () => {
    expect(cycleOptions(NOW, undefined)).toEqual([2026, 2025, 2024]);
  });

  it('keeps an older year from the URL so the select can show it', () => {
    expect(cycleOptions(NOW, 2019)).toEqual([2026, 2025, 2024, 2019]);
    expect(cycleOptions(NOW, 2025)).toEqual([2026, 2025, 2024]);
  });
});
