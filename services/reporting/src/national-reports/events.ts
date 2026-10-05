import type { DraftScope, NationalReportStatus } from './schema.js';

/**
 * Events the reporting service publishes about the national consolidated report (spec 09,
 * outbox, CloudEvents). Identifiers, the year, counts and statuses only: never the narrative, the
 * figures or a name. The tenant extension is `eacc` and the subject the report id.
 */
export const NCR_DRAFTED = 'ncr.drafted.v1';

/** `ncr.drafted.v1`: an EACC analyst built (or rebuilt) the draft from the submitted reports. */
export interface NcrDraftedData extends Record<string, unknown> {
  nationalReportId: string;
  fy: number;
  version: number;
  status: NationalReportStatus;
  reference: null;
  reportsIncluded: number;
}

export const NCR_APPROVED = 'ncr.approved.v1';

/** `ncr.approved.v1`: an EACC supervisor approved the report under its `NCR` reference. */
export interface NcrApprovedData extends Record<string, unknown> {
  nationalReportId: string;
  fy: number;
  version: number;
  status: NationalReportStatus;
  reference: string;
  reportsIncluded: number;
}

export const NCR_NARRATIVE_DRAFTED = 'ncr.narrative-drafted.v1';

/**
 * `ncr.narrative-drafted.v1` (spec 09b): the ai-gateway's draft of the narrative (the section
 * asked for, or `all`) was inserted as AI-draft paragraphs. The job ids (one per gateway call)
 * tie it to the gateway's audit of the AI calls; no text, no figures.
 */
export interface NcrNarrativeDraftedData extends Record<string, unknown> {
  nationalReportId: string;
  fy: number;
  section: DraftScope;
  jobIds: string[];
}
