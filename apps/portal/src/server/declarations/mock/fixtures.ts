/**
 * The mock's fixtures: the Commissions, what their rosters hold about each mock declarant, and
 * the obligations tests start declarations for (`MOCK_OBLIGATIONS`).
 */

import type { MaritalStatus, PersonName } from '../../../declaration/contents';
import type { CommissionRef, Obligation } from '../types';

export const COMMISSIONS = {
  tsc: { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' },
  psc: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
  npsc: { slug: 'npsc', issuerCode: 'NPSC', name: 'National Police Service Commission' },
  parlsc: { slug: 'parlsc', issuerCode: 'PSCK', name: 'Parliamentary Service Commission' },
} satisfies Record<string, CommissionRef>;

/** HR values a roster may hold; each pre-fills the bio and stays editable (spec 05b S8). */
export interface RosterHr {
  maritalStatus?: MaritalStatus;
  jobGroup?: string;
  appointmentDate?: string;
  workStation?: string;
}

/** What a Commission's roster says about a declarant. */
export interface RosterEntry {
  name: PersonName;
  designation: string;
  employer: string;
  file: string;
  hr?: RosterHr;
}

const WANJIKU: PersonName = { surname: 'Kamau', firstName: 'Wanjiku', otherNames: 'Njoki' };
const GRACE: PersonName = { surname: 'Njeri', firstName: 'Grace', otherNames: 'Wambui' };

/**
 * What each Commission's roster says about each mock declarant, by Commission slug: the demo
 * declarant (anyone the obligations mock does not know by name) and Grace Wambui Njeri
 * (OFR-0000417-4, as in the directory mock). A draft's bio is pre-filled from its owner's
 * entry, as the service reads the roster for the caller's person.
 */
export const ROSTERS: Record<'demo' | 'grace', Record<string, RosterEntry>> = {
  demo: {
    tsc: {
      name: WANJIKU,
      designation: 'Deputy Principal',
      employer: 'Nyeri High School',
      file: 'TSC/999999',
      hr: {
        maritalStatus: 'married',
        jobGroup: 'D3 (T-Scale 13)',
        appointmentDate: '2026-09-02',
        workStation: 'Eldoret, Uasin Gishu',
      },
    },
    psc: {
      name: WANJIKU,
      designation: 'Principal Accountant',
      employer: 'State Department for Devolution',
      file: 'PSC/300400',
    },
  },
  grace: {
    psc: {
      name: GRACE,
      designation: 'Senior Human Resource Officer',
      employer: 'State Department for Public Service',
      file: 'PSC/2009/118204',
    },
    npsc: {
      name: GRACE,
      designation: 'Inspector',
      employer: 'Kilimani Police Station',
      file: 'NPSC/400500',
    },
  },
};

export const MOCK_OBLIGATIONS = {
  biennial: '0b1e5a1d-5c0a-4d3e-9f10-000000000001',
  initial: '0b1e5a1d-5c0a-4d3e-9f10-000000000002',
  filed: '0b1e5a1d-5c0a-4d3e-9f10-000000000003',
  cancelled: '0b1e5a1d-5c0a-4d3e-9f10-000000000004',
} as const;

export const OBLIGATIONS: Obligation[] = [
  {
    id: MOCK_OBLIGATIONS.biennial,
    commission: COMMISSIONS.tsc,
    type: 'biennial',
    cycleKey: 'biennial:2027',
    statementDate: '2027-11-01',
    dueDate: '2027-12-31',
    status: 'upcoming',
    cancelReason: null,
    remindersSent: 0,
    policyVersion: 1,
    createdAt: '2026-09-01T06:00:00Z',
  },
  {
    id: MOCK_OBLIGATIONS.initial,
    commission: COMMISSIONS.psc,
    type: 'initial',
    cycleKey: 'initial:2026-09-10',
    statementDate: '2026-09-10',
    dueDate: '2026-10-10',
    status: 'due',
    cancelReason: null,
    remindersSent: 1,
    policyVersion: 1,
    createdAt: '2026-09-10T06:00:00Z',
  },
  {
    id: MOCK_OBLIGATIONS.filed,
    commission: COMMISSIONS.npsc,
    type: 'final',
    cycleKey: 'final:2026-03-31',
    statementDate: '2026-03-31',
    dueDate: '2026-04-30',
    status: 'filed',
    cancelReason: null,
    remindersSent: 2,
    policyVersion: 1,
    createdAt: '2026-03-31T06:00:00Z',
  },
  {
    id: MOCK_OBLIGATIONS.cancelled,
    commission: COMMISSIONS.parlsc,
    type: 'biennial',
    cycleKey: 'biennial:2025',
    statementDate: '2025-11-01',
    dueDate: '2025-12-31',
    status: 'cancelled',
    cancelReason: 'exited-before-statement-date',
    remindersSent: 0,
    policyVersion: 1,
    createdAt: '2025-09-01T06:00:00Z',
  },
] as Obligation[];
