import { describe, expect, it } from 'vitest';

import type { Draft, Officer } from './contents';
import { isFromRoster, rosterPrefill, rosterValuesOf } from './roster-prefill';

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
  it('reads the roster values from a never-saved bio', () => {
    expect(rosterPrefill(prefilled, true)).toEqual(rosterValuesOf(prefilled));
  });

  it('claims nothing for a bio that was saved', () => {
    expect(rosterPrefill(prefilled, false)).toEqual({});
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
