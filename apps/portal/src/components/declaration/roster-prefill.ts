import type { Draft, Officer } from '../../declaration/contents';

/** The Your details answers the Commission's roster can pre-fill (spec 05b S8); all editable. */
export const ROSTER_FIELDS = [
  'maritalStatus',
  'jobGroup',
  'appointmentDate',
  'workStation',
] as const;
export type RosterField = (typeof ROSTER_FIELDS)[number];

export type RosterValues = Partial<Record<RosterField, string>>;

/** No values from the roster; one object, so a React snapshot of it stays stable. */
export const NO_ROSTER_VALUES: RosterValues = Object.freeze({});

export const ROSTER_HINT = "From your Commission's roster";

/** The roster-fillable answers in a bio as it stands. */
export function rosterValuesOf(officer: Draft<Officer>): RosterValues {
  const values: RosterValues = {
    maritalStatus: officer.maritalStatus,
    jobGroup: officer.employment?.jobGroup,
    appointmentDate: officer.employment?.appointmentDate,
    workStation: officer.employment?.workStation,
  };
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => typeof value === 'string' && value !== ''),
  );
}

/** Whether an answer still holds the value the roster pre-filled. */
export function isFromRoster(
  field: RosterField,
  officer: Draft<Officer>,
  roster: RosterValues,
): boolean {
  const prefilled = roster[field];
  return prefilled !== undefined && rosterValuesOf(officer)[field] === prefilled;
}

/**
 * The values the roster pre-filled, read from the bio as the service returned it. The contract
 * records no field-level provenance (contract gap), so they are known only while the bio has
 * never been saved: then everything in it came from the roster pre-fill. Once saved, nothing is
 * claimed to be from the roster.
 */
export function rosterPrefill(loaded: Draft<Officer>, neverSaved: boolean): RosterValues {
  return neverSaved ? rosterValuesOf(loaded) : NO_ROSTER_VALUES;
}
