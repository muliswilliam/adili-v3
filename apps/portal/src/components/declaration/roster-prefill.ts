import type { Draft, Officer } from './contents';

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
 * Where the pre-filled values are remembered. The contract records no field-level provenance,
 * so the portal keeps what the bio held before the declarant first saved it: until then
 * everything in it came from the service's roster pre-fill. Kept per draft in this browser.
 */
export interface RosterStore {
  get(declarationId: string): RosterValues | undefined;
  set(declarationId: string, values: RosterValues): void;
}

const memory = new Map<string, RosterValues>();
const storageKey = (declarationId: string) => `adili:roster-prefill:${declarationId}`;

export const browserRosterStore: RosterStore = {
  get(declarationId) {
    const remembered = memory.get(declarationId);
    if (remembered) return remembered;
    try {
      const raw = window.localStorage.getItem(storageKey(declarationId));
      if (!raw) return undefined;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return undefined;
      const values = Object.fromEntries(
        Object.entries(parsed).filter(
          ([key, value]) =>
            (ROSTER_FIELDS as readonly string[]).includes(key) && typeof value === 'string',
        ),
      ) as RosterValues;
      memory.set(declarationId, values);
      return values;
    } catch {
      return undefined;
    }
  },
  set(declarationId, values) {
    memory.set(declarationId, values);
    try {
      window.localStorage.setItem(storageKey(declarationId), JSON.stringify(values));
    } catch {
      // Private window or blocked storage: remembered for this page load only.
    }
  },
};

/**
 * The values the roster pre-filled for this draft. A bio never saved holds only the pre-fill,
 * so it is remembered then; later loads use what was remembered. Without a record (another
 * browser after the first save) nothing is claimed to be from the roster. Returns the stored
 * object itself, so repeated calls give the same one.
 */
export function rosterPrefill(
  store: RosterStore,
  declarationId: string,
  loaded: Draft<Officer>,
  neverSaved: boolean,
): RosterValues {
  const remembered = store.get(declarationId);
  if (remembered) return remembered;
  if (!neverSaved) return NO_ROSTER_VALUES;
  store.set(declarationId, rosterValuesOf(loaded));
  return store.get(declarationId) ?? NO_ROSTER_VALUES;
}
