/**
 * `@adili/events/contracts`: event types and data other services read, with their enums. Plain
 * values and types, no framework imports, so schemas and workflow code can use them too.
 */
export {
  OBLIGATION_CYCLE_OPENED,
  OBLIGATION_REMINDER_RECORDED,
  type ObligationCycleOpenedData,
  type ObligationReminderRecordedData,
  REMINDER_CHANNELS,
  REMINDER_OUTCOMES,
  type ReminderChannel,
  type ReminderOutcome,
} from './obligations.js';
