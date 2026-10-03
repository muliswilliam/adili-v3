import type { components } from './api.gen';

/** The reporting contract's schemas the console reads (reporting.yaml). */
type Schemas = components['schemas'];

export type ReferralIntakeItem = Schemas['ReferralIntakeItem'];
export type ReferralIntakePage = Schemas['ReferralIntakePage'];
export type IcmsStatus = Schemas['IcmsStatus'];
export type IcmsPushError = Schemas['IcmsPushError'];
export type IntakeReferralGrounds = Schemas['ReferralGrounds'];
export type ReportingOfficer = Schemas['Officer'];
