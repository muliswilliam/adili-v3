import type { components } from './schema.gen';

type Schemas = components['schemas'];

export type Commission = Schemas['Commission'];
export type CommissionType = Schemas['CommissionType'];
export type OfficerCategory = Schemas['OfficerCategory'];
export type ProblemDetails = Schemas['ProblemDetails'];
export type ReportingOfficer = Schemas['ReportingOfficer'];

export interface CommissionPage {
  items: Commission[];
  nextCursor: string | null;
}
