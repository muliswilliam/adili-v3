import type { NewEvent } from '@adili/events';

import type { CancelReason, ObligationStatus, ObligationType } from './engine.js';
import type { ReminderChannel, ReminderOutcome } from './schema.js';

/**
 * Events the declarations service publishes about filing obligations (spec 04). Identifiers and
 * dates only: no names, contacts or OFRs (ADR-013 §3). The `tenant` extension is the Commission's
 * slug; the subject is the obligation.
 */

export const OBLIGATION_CREATED = 'obligation.created.v1';

export interface ObligationCreatedData extends Record<string, unknown> {
  obligationId: string;
  rosterRecordId: string;
  type: ObligationType;
  cycleKey: string;
  statementDate: string;
  dueDate: string;
}

export function obligationCreated(
  tenant: string,
  data: ObligationCreatedData,
): NewEvent<ObligationCreatedData> {
  return { type: OBLIGATION_CREATED, subject: data.obligationId, tenant, data };
}

export const OBLIGATION_STATUS_CHANGED = 'obligation.status-changed.v1';

export interface ObligationStatusChangedData extends Record<string, unknown> {
  obligationId: string;
  from: ObligationStatus;
  to: ObligationStatus;
  /** Why, for a cancellation; null otherwise. */
  reason: CancelReason | null;
}

export function obligationStatusChanged(
  tenant: string,
  data: ObligationStatusChangedData,
): NewEvent<ObligationStatusChangedData> {
  return { type: OBLIGATION_STATUS_CHANGED, subject: data.obligationId, tenant, data };
}

export const OBLIGATION_REMINDER_SENT = 'obligation.reminder-sent.v1';

/** A reminder's outcome, whether sent or skipped (and why) or failed. */
export interface ObligationReminderSentData extends Record<string, unknown> {
  obligationId: string;
  offsetDays: number;
  /** The channels it went out on; empty unless sent. */
  channels: ReminderChannel[];
  outcome: ReminderOutcome;
}

export function obligationReminderSent(
  tenant: string,
  data: ObligationReminderSentData,
): NewEvent<ObligationReminderSentData> {
  return { type: OBLIGATION_REMINDER_SENT, subject: data.obligationId, tenant, data };
}

export const CYCLE_OPENED = 'obligations.cycle-opened.v1';

/** A Commission's biennial cycle opened: its active officers' obligations for it exist. */
export interface CycleOpenedData extends Record<string, unknown> {
  cycleYear: number;
  /** Biennial obligations the opening created. */
  count: number;
}

/** Subject: the cycle key (`biennial:<year>`); tenant: the Commission. */
export function cycleOpened(tenant: string, data: CycleOpenedData): NewEvent<CycleOpenedData> {
  return { type: CYCLE_OPENED, subject: `biennial:${String(data.cycleYear)}`, tenant, data };
}

/** The directory events the declarations service consumes, and their data (ids only). */
export const ROSTER_IMPORT_COMPLETED = 'roster.import.completed.v1';
export const ROSTER_EXITS_CONFIRMED = 'roster.exits.confirmed.v1';
export const DECLARANT_ONBOARDED = 'declarant.onboarded.v1';
export const POLICY_CHANGED = 'directory.policy.changed.v1';
