import type { FormMV1 } from '@adili/forms';

import type { Officer, ReportStatus } from './types';

/**
 * The reporting mocks' shared state: the Public Service Commission's Form M reports by financial
 * year and the mocks' day. The Form M workspace mock (`mock.server.ts`) seeds and changes it;
 * the EACC intake mock (`eacc-mock.server.ts`) reads it, so a report submitted in the workspace
 * reaches EACC. Neither mock imports the other's module, only this one.
 */

/** One year's report as the workspace mock holds it. */
export interface StoredReport {
  fy: number;
  status: Exclude<ReportStatus, 'not-started'>;
  compiledAt: string | null;
  /** While compiling: when the compile started. */
  compileStartedAt: number | null;
  submittedAt: string | null;
  late: boolean | null;
  reference: string | null;
  reviewedBy: Officer | null;
  confirmedBy: Officer | null;
  document: FormMV1 | null;
}

/** The Public Service Commission's reports, by financial year (start year). */
export const storedReports = new Map<number, StoredReport>();

let day = '';
let seed: (() => void) | null = null;

/**
 * How the workspace mock seeds the store on its first read (from REPORTING_MOCK_TODAY); it
 * registers this when it loads.
 */
export function seedMockStoreWith(seeder: () => void) {
  seed = seeder;
}

/** Whether the store has been seeded for a day. */
export const mockStoreSeeded = () => day !== '';

/** Sets the mocks' day (`YYYY-MM-DD`), when the workspace mock seeds the store. */
export function setMockDay(value: string) {
  day = value;
}

/** The mocks' day: REPORTING_MOCK_TODAY, else today in Nairobi; seeds the store first if needed. */
export function mockDay(): string {
  if (day === '') seed?.();
  return day;
}
