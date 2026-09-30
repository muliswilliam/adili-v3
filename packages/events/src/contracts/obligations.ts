/**
 * Event contracts the declarations service publishes about filing obligations (spec 04) that
 * other services read the values of: the event types and their data, with the enums in them, so
 * a consumer (audit, reporting, notifications) matches the publisher's values rather than a copy.
 */

/** A reminder's outcome, recorded whether it was sent, skipped (and why) or failed. */
export const REMINDER_OUTCOMES = [
  'sent',
  'skipped-not-onboarded',
  'skipped-no-contact',
  'skipped-past-due-at-creation',
  'skipped-missed',
  'failed',
] as const;
export type ReminderOutcome = (typeof REMINDER_OUTCOMES)[number];

/** The channels a reminder goes out on. */
export const REMINDER_CHANNELS = ['sms', 'email'] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

/** A reminder's outcome was recorded. Subject: the obligation; tenant: its Commission. */
export const OBLIGATION_REMINDER_RECORDED = 'obligation.reminder.recorded.v1';

export interface ObligationReminderRecordedData extends Record<string, unknown> {
  obligationId: string;
  offsetDays: number;
  /** The channels it went out on; empty unless sent. */
  channels: ReminderChannel[];
  outcome: ReminderOutcome;
}

/**
 * A Commission's biennial cycle opened: the obligations of the declarants on its roster exist.
 * Subject: the cycle key (`biennial:<year>`); tenant: the Commission.
 */
export const OBLIGATION_CYCLE_OPENED = 'obligation.cycle.opened.v1';

export interface ObligationCycleOpenedData extends Record<string, unknown> {
  cycleYear: number;
  /** Biennial obligations the opening created. */
  count: number;
}
