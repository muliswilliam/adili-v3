import type { CivilDate } from './dates.js';

/**
 * An obligation's cycle key: which duty of a roster record it is. Unique per record among live
 * obligations. The initial and final carry their date, so a corrected date is another obligation.
 */
export type CycleKey = `initial:${CivilDate}` | `biennial:${string}` | `final:${CivilDate}`;

export const initialCycleKey = (appointmentDate: CivilDate): CycleKey =>
  `initial:${appointmentDate}`;

export const biennialCycleKey = (year: number): CycleKey => `biennial:${String(year)}`;

export const finalCycleKey = (exitDate: CivilDate): CycleKey => `final:${exitDate}`;

/** A biennial cycle key, `biennial:<year>`. */
export const BIENNIAL_CYCLE_KEY = /^biennial:(\d{4})$/;

/** The year of a biennial cycle key; null for any other key. */
export function biennialYear(key: string): number | null {
  const year = BIENNIAL_CYCLE_KEY.exec(key)?.[1];
  return year === undefined ? null : Number(year);
}
