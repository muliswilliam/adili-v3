import type { DeterminationView } from '../determinations/representation.js';
import type { Evidence, ItemRef, Severity } from '../rules/index.js';
import type {
  CaseStatus,
  ClarificationItem,
  ClarificationStatus,
  DeclarationType,
  reviewCases,
  reviewFlags,
} from './schema.js';

/** review.yaml `Assignee`. */
export interface Assignee {
  subject: string;
  name: string;
}

/** An officer as a view names them: the name their token gave, else their subject. */
export function officer(subject: string | null, name: string | null): Assignee | null {
  return subject === null ? null : { subject, name: name ?? subject };
}

/** review.yaml `CaseListItem`: a row of the queue. */
export interface CaseListItem {
  id: string;
  reference: string;
  declarantName: string;
  personnelFileNumber: string;
  type: DeclarationType;
  cycleYear: number;
  receivedAt: string;
  windowEndsAt: string;
  late: boolean;
  band: 'low' | 'medium' | 'high';
  status: CaseStatus;
  assignee: Assignee | null;
  openFlags: number;
  clarification: {
    /** Clarifications the declarant still has to answer. */
    open: number;
    /** The status of the latest clarification issued; null when none was. */
    status: ClarificationStatus | null;
    dueAt: string | null;
  };
  currentVersion: number;
}

export interface CasePage {
  items: CaseListItem[];
  nextCursor: string | null;
}

/** review.yaml `QueueSummary`. */
export interface QueueSummary {
  byStatus: Record<string, number>;
  byBand: Record<string, number>;
  overdueClarifications: number;
}

type CaseRow = typeof reviewCases.$inferSelect;

/** The latest clarification issued on a case, for its queue row. */
export interface LatestClarification {
  status: ClarificationStatus;
  dueAt: Date | null;
}

/** A case row as the queue and the case actions show it. */
export function caseListItem(row: CaseRow, latest: LatestClarification | undefined): CaseListItem {
  return {
    id: row.id,
    reference: row.reference,
    declarantName: row.declarantName,
    personnelFileNumber: row.personnelFileNumber,
    type: row.type,
    cycleYear: row.cycleYear,
    receivedAt: row.receivedAt.toISOString(),
    windowEndsAt: row.windowEndsAt.toISOString(),
    late: row.late,
    band: row.band,
    status: row.status,
    assignee:
      row.assignee === null
        ? null
        : { subject: row.assignee, name: row.assigneeName ?? row.assignee },
    openFlags: row.openFlags,
    clarification: {
      open: row.openClarifications,
      status: latest?.status ?? null,
      dueAt: latest?.dueAt?.toISOString() ?? null,
    },
    currentVersion: row.currentVersion,
  };
}

/** review.yaml `Flag`. */
export interface FlagView {
  id: string;
  versionId: string;
  ruleId: string;
  severity: Severity;
  title: string;
  indicator: string;
  evidence: Evidence;
  itemRefs: ItemRef[];
  reviewed: { at: string; by: Assignee; note: string } | null;
  recomputed: boolean;
}

/** review.yaml `Note`. */
export interface NoteView {
  id: string;
  author: Assignee;
  text: string;
  at: string;
}

/** review.yaml `TimelineEntry`; the actor is null for the service's own work. */
export interface TimelineEntryView {
  id: string;
  kind: string;
  actor: Assignee | null;
  at: string;
  summary: string;
  ref: string | null;
}

/** review.yaml `Clarification`, as the case view lists it. */
export interface ClarificationView {
  id: string;
  caseId: string;
  reference: string | null;
  status: ClarificationStatus;
  items: (Omit<ClarificationItem, 'id' | 'aiJobId'> & { aiJobId: string | null })[];
  issuedAt: string | null;
  dueAt: string | null;
  respondedAt: string | null;
  responseLate: boolean;
  resolvedAt: string | null;
  resolutionNote: string | null;
  letter: {
    documentId: string;
    verificationId: string;
    status: 'pending' | 'issued' | 'revoked';
  } | null;
  followUpOf: string | null;
  /** The letter's opening paragraph, before the items; null when it has none. */
  opening: string | null;
  /** The Draft with AI job that drafted the opening paragraph; null when the reviewer wrote it. */
  openingAiJobId: string | null;
  response: {
    items: {
      index: number;
      text: string;
      attachments: { uploadId: string; fileName: string; sha256: string }[];
    }[];
    submittedAt: string;
  } | null;
}

/** A version the case has processed, from the review service's own records. */
export interface CaseVersionView {
  versionId: string;
  version: number;
  submittedAt: string;
  late: boolean;
  amendment: boolean;
}

/** review.yaml `CaseDetail`; `document` is null when declarations could not be read. */
export interface CaseDetail {
  case: CaseListItem;
  flags: FlagView[];
  clarifications: ClarificationView[];
  notes: NoteView[];
  timeline: TimelineEntryView[];
  document: Record<string, unknown> | null;
  versions: CaseVersionView[];
  reviewerHistory: Assignee[];
  /** Every determination of the case, oldest first: the current one last (spec 08). */
  determinations: DeterminationView[];
}

/** A short-lived link to an attachment of the declaration under review. */
export interface AttachmentDownload {
  downloadUrl: string;
  expiresAt: string;
}

/** A flag row as the case view shows it; `officer` names the reviewer. */
export function flagView(
  flag: typeof reviewFlags.$inferSelect,
  officer: (subject: string) => Assignee,
): FlagView {
  return {
    id: flag.id,
    versionId: flag.versionId,
    ruleId: flag.ruleId,
    severity: flag.severity,
    title: flag.title,
    indicator: flag.indicator,
    evidence: flag.evidence,
    itemRefs: flag.itemRefs,
    reviewed:
      flag.reviewedAt === null || flag.reviewedBy === null
        ? null
        : {
            at: flag.reviewedAt.toISOString(),
            by: officer(flag.reviewedBy),
            note: flag.reviewNote ?? '',
          },
    recomputed: flag.recomputed,
  };
}
