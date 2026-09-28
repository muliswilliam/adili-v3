import type {
  ObligationStatus as SharedObligationStatus,
  ObligationType as SharedObligationType,
  ReminderChannel as SharedReminderChannel,
  ReminderOutcome as SharedReminderOutcome,
} from '@adili/ui';

import type { components } from './schema.gen';

type Schemas = components['schemas'];

export type CommissionRef = Schemas['CommissionRef'];
export type Obligation = Schemas['Obligation'];
export type ObligationDetail = Schemas['ObligationDetail'];
export type ObligationStatus = Schemas['ObligationStatus'];
export type ObligationType = Schemas['ObligationType'];
export type MyObligations = Schemas['MyObligations'];
export type ObligationGroup = MyObligations['groups'][number];
export type Reminder = Schemas['Reminder'];
export type ReminderOutcome = Schemas['ReminderOutcome'];

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

/** Fails to compile when the contract and the shared copy table in @adili/ui drift apart. */
export type ContractMatchesSharedCopy = [
  Assert<Same<ObligationType, SharedObligationType>>,
  Assert<Same<ObligationStatus, SharedObligationStatus>>,
  Assert<Same<ReminderOutcome, SharedReminderOutcome>>,
  Assert<Same<Reminder['channels'][number], SharedReminderChannel>>,
];
