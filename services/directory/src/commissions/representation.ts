/**
 * Response shapes of the Commissions API, as in packages/schemas/internal/directory.yaml
 * (`Commission`, `OfficerCategory`, `ReportingOfficer`, `RosterSummary`, the list page).
 */

export type CommissionType = 'hosted' | 'federated';
export type ReportingOfficerState = 'invited' | 'activated' | 'replaced';

export interface OfficerCategory {
  code: string;
  citation: string;
  description: string;
}

export interface ReportingOfficer {
  id: string;
  name: string;
  email: string;
  phone: string;
  state: ReportingOfficerState;
  invitedAt: string;
  activatedAt: string | null;
}

export interface RosterSummary {
  status: 'none' | 'imported';
  expectedDeclarants: number;
  onboardedDeclarants: number;
  flagged: number;
  lastImportAt: string | null;
  lastImportId: string | null;
}

export interface Commission {
  id: string;
  slug: string;
  issuerCode: string;
  name: string;
  type: CommissionType;
  categories: OfficerCategory[];
  status: 'active';
  policyVersion: number;
  reportingOfficer: ReportingOfficer | null;
  roster: RosterSummary;
  createdAt: string;
}

export interface CommissionPage {
  items: Commission[];
  nextCursor: string | null;
  /** Commissions matching the filters, across all pages. */
  total: number;
}

/** Roster summary until slice 02 imports rosters. */
export const NO_ROSTER: RosterSummary = {
  status: 'none',
  expectedDeclarants: 0,
  onboardedDeclarants: 0,
  flagged: 0,
  lastImportAt: null,
  lastImportId: null,
};
