import type { CaseStatus, ClarificationStatus, DeclarationType } from './schema.js';

/** review.yaml `Assignee`. */
export interface Assignee {
  subject: string;
  name: string;
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
