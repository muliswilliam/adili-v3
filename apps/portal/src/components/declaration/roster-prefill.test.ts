import { describe, expect, it } from 'vitest';

import type { Draft, Officer } from './contents';
import {
  isFromRoster,
  type RosterStore,
  type RosterValues,
  rosterPrefill,
  rosterValuesOf,
} from './roster-prefill';

const ID = 'd0000000-0000-4000-8000-000000000001';

const prefilled: Draft<Officer> = {
  name: { surname: 'Kamau', firstName: 'Mwangi' },
  maritalStatus: 'married',
  employment: {
    designation: 'Deputy Principal',
    jobGroup: 'D3 (T-Scale 13)',
    appointmentDate: '2026-09-02',
    workStation: 'Eldoret, Uasin Gishu',
  },
};

function memoryStore(): RosterStore & { saved: Map<string, RosterValues> } {
  const saved = new Map<string, RosterValues>();
  return {
    saved,
    get: (id) => saved.get(id),
    set: (id, values) => {
      saved.set(id, values);
    },
  };
}

describe('rosterValuesOf', () => {
  it('keeps the roster-fillable answers that are present', () => {
    expect(rosterValuesOf(prefilled)).toEqual({
      maritalStatus: 'married',
      jobGroup: 'D3 (T-Scale 13)',
      appointmentDate: '2026-09-02',
      workStation: 'Eldoret, Uasin Gishu',
    });
    expect(rosterValuesOf({ employment: { jobGroup: '' } })).toEqual({});
  });
});

describe('rosterPrefill', () => {
  it('remembers what a never-saved bio holds', () => {
    const store = memoryStore();
    expect(rosterPrefill(store, ID, prefilled, true)).toEqual(rosterValuesOf(prefilled));
    expect(store.saved.get(ID)).toEqual(rosterValuesOf(prefilled));
  });

  it('uses what was remembered once the bio was saved', () => {
    const store = memoryStore();
    rosterPrefill(store, ID, prefilled, true);
    const edited = { ...prefilled, employment: { ...prefilled.employment, jobGroup: 'D4' } };
    expect(rosterPrefill(store, ID, edited, false).jobGroup).toBe('D3 (T-Scale 13)');
  });

  it('claims nothing for a saved bio it has no record of', () => {
    expect(rosterPrefill(memoryStore(), ID, prefilled, false)).toEqual({});
  });
});

describe('isFromRoster', () => {
  const roster = rosterValuesOf(prefilled);

  it('is true while the answer still equals the roster value', () => {
    expect(isFromRoster('jobGroup', prefilled, roster)).toBe(true);
    expect(isFromRoster('maritalStatus', prefilled, roster)).toBe(true);
  });

  it('is false once changed or cleared, or when the roster had nothing', () => {
    const changed = { ...prefilled, employment: { ...prefilled.employment, jobGroup: 'D4' } };
    expect(isFromRoster('jobGroup', changed, roster)).toBe(false);
    expect(isFromRoster('workStation', { ...prefilled, employment: {} }, roster)).toBe(false);
    expect(isFromRoster('jobGroup', { employment: { jobGroup: 'D3' } }, {})).toBe(false);
  });
});
