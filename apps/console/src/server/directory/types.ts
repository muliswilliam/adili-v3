import type { components, operations } from './schema.gen';

type Schemas = components['schemas'];

export type Commission = Schemas['Commission'];
export type CommissionType = Schemas['CommissionType'];
export type OfficerCategory = Schemas['OfficerCategory'];
export type ProblemDetails = Schemas['ProblemDetails'];
export type ReportingOfficer = Schemas['ReportingOfficer'];
export type RosterSummary = Schemas['RosterSummary'];

type ListCommissions = operations['listCommissions'];

/** One page of `GET /v1/commissions`, as the contract defines it. */
export type CommissionPage = ListCommissions['responses'][200]['content']['application/json'];

/** The query `GET /v1/commissions` accepts. */
export type CommissionListQuery = NonNullable<ListCommissions['parameters']['query']>;

/** The list's reporting-officer filter; `none` means no assignment yet. */
export type ReportingOfficerFilter = NonNullable<CommissionListQuery['reportingOfficer']>;
