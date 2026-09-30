import {
  type NewEvent,
  OBLIGATION_CYCLE_OPENED,
  OBLIGATION_REMINDER_RECORDED,
  type ObligationCycleOpenedData,
  type ObligationReminderRecordedData,
} from '@adili/events';

import { biennialCycleKey } from './cycle-key.js';
import type { CancelReason, ObligationStatus, ObligationType } from './engine.js';

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

/**
 * `obligation.reminder.recorded.v1` and `obligation.cycle.opened.v1` are read by other services,
 * so their contracts (with the reminder outcomes) live in `@adili/events`.
 */
export {
  OBLIGATION_CYCLE_OPENED,
  OBLIGATION_REMINDER_RECORDED,
  type ObligationCycleOpenedData,
  type ObligationReminderRecordedData,
};

/** A reminder's outcome, whether sent or skipped (and why) or failed. */
export function obligationReminderRecorded(
  tenant: string,
  data: ObligationReminderRecordedData,
): NewEvent<ObligationReminderRecordedData> {
  return { type: OBLIGATION_REMINDER_RECORDED, subject: data.obligationId, tenant, data };
}

/** A Commission's biennial cycle opened. Subject: the cycle key (`biennial:<year>`); tenant: the Commission. */
export function cycleOpened(
  tenant: string,
  data: ObligationCycleOpenedData,
): NewEvent<ObligationCycleOpenedData> {
  return { type: OBLIGATION_CYCLE_OPENED, subject: biennialCycleKey(data.cycleYear), tenant, data };
}

/** The directory events the declarations service consumes, and their data (ids only). */
export const ROSTER_IMPORT_COMPLETED = 'roster.import.completed.v1';
export const ROSTER_EXITS_CONFIRMED = 'roster.exits.confirmed.v1';
export const DECLARANT_ONBOARDED = 'declarant.onboarded.v1';
export const POLICY_CHANGED = 'directory.policy.changed.v1';
export const COMMISSION_CREATED = 'commission.created.v1';
