import type { ProposerKind } from '../approvals/schema.js';
import type { Assignee } from '../cases/representation.js';
import { officer } from '../cases/representation.js';
import type { EvidencePreviewItem } from './evidence-package.js';
import type {
  ManifestItem,
  ReferralGrounds,
  ReferralSources,
  ReferralStatus,
  referrals,
} from './schema.js';

type ReferralRow = typeof referrals.$inferSelect;

/** review.yaml `Referral`. */
export interface ReferralView {
  id: string;
  caseId: string | null;
  cycleYear: number;
  grounds: ReferralGrounds;
  proposerKind: ProposerKind;
  proposer: Assignee | null;
  proposedAt: string;
  status: ReferralStatus;
  approver: Assignee | null;
  approvedAt: string | null;
  declinedBy: Assignee | null;
  declinedAt: string | null;
  declineNote: string | null;
  reference: string | null;
  sources: ReferralSources;
  narrative: string;
  package: { documentId: string; verificationId: string; manifest: ManifestItem[] } | null;
  sentAt: string | null;
  /** ICMS's case number once EACC registered the referral there (spec 09); null until then. */
  icmsCaseNumber: string | null;
  icmsRegisteredAt: string | null;
  declarantName: string;
  personnelFileNumber: string;
  /** `getReferral` only: what the package includes, by reference (the preview before approval). */
  evidence?: EvidencePreviewItem[];
}

export function referralView(row: ReferralRow, evidence?: EvidencePreviewItem[]): ReferralView {
  return {
    id: row.id,
    caseId: row.caseId,
    cycleYear: row.cycleYear,
    grounds: row.grounds,
    proposerKind: row.proposerKind,
    proposer: officer(row.proposer, row.proposerName),
    proposedAt: row.proposedAt.toISOString(),
    status: row.status,
    approver: officer(row.approver, row.approverName),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    declinedBy: officer(row.declinedBy, row.declinedByName),
    declinedAt: row.declinedAt?.toISOString() ?? null,
    declineNote: row.declineNote,
    reference: row.reference,
    sources: row.sources,
    narrative: row.narrative,
    package:
      row.packageDocumentId !== null &&
      row.packageVerificationId !== null &&
      row.packageManifest !== null
        ? {
            documentId: row.packageDocumentId,
            verificationId: row.packageVerificationId,
            manifest: row.packageManifest,
          }
        : null,
    sentAt: row.sentAt?.toISOString() ?? null,
    icmsCaseNumber: row.icmsCaseNumber,
    icmsRegisteredAt: row.icmsRegisteredAt?.toISOString() ?? null,
    declarantName: row.declarantName,
    personnelFileNumber: row.personnelFileNumber,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

/** How the console and the package's cover sheet name each ground (FE label table). */
export const GROUNDS_LABELS: Record<ReferralGrounds, string> = {
  'undeclared-assets': 'Undeclared assets',
  'unexplained-assets': 'Unexplained assets',
  'two-missed-cycles': 'Two consecutive declarations not filed',
  'unanswered-clarification': 'Clarification not answered',
};
