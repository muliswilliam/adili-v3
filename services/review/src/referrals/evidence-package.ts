import { createHash } from 'node:crypto';

import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';

import type { ReviewTransaction } from '../cases/case-lookup.js';
import {
  clarificationResponses,
  clarifications,
  reviewCases,
  reviewCaseVersions,
  reviewFlags,
} from '../cases/schema.js';
import type {
  DeclarationsClient,
  PersonObligation,
  PulledVersion,
} from '../declarations/declarations-client.js';
import type { DocumentsClient } from '../documents/documents-client.js';
import { administrativeActions, enforcementLadders } from '../enforcement/schema.js';
import { SYSTEM_SUBJECT } from '../system-context.js';
import type { ManifestItem, ManifestKind, referrals } from './schema.js';

type ReferralRow = typeof referrals.$inferSelect;
type FlagRow = typeof reviewFlags.$inferSelect;
type ClarificationRow = typeof clarifications.$inferSelect;
type ClarificationResponseRow = typeof clarificationResponses.$inferSelect;

/**
 * The evidence package of a referral (spec 08): what it rests on, read from this service's
 * database (the plan), then pulled from declarations and documents and hashed (the manifest). The
 * plan names the records; the pull gives the content the package includes, never stored here.
 */

/** A submitted version of a source case, as the package includes it. */
export interface PlannedVersion {
  caseId: string;
  declarationId: string;
  version: number;
  /** The declaration's reference (ADR-011). */
  reference: string;
}

/** A letter the package lists: a clarification letter or a ladder step's letter. */
export interface PlannedLetter {
  documentId: string;
  /** The `CLR` or `ADM` reference it was issued under. */
  reference: string;
}

/** What a referral's package will contain, from this service's own records. */
export interface EvidencePlan {
  versions: PlannedVersion[];
  flags: (FlagRow & { caseReference: string })[];
  clarifications: { clarification: ClarificationRow; response: ClarificationResponseRow | null }[];
  /** The obligations the referral names, with the cycle key their ladders recorded (if any). */
  obligations: { obligationId: string; cycleKey: string | null }[];
  letters: PlannedLetter[];
}

/** One line of the package preview a supervisor reads before approving. */
export interface EvidencePreviewItem {
  kind: ManifestKind;
  reference: string;
}

/** The evidence pulled and hashed: the content the package renders, and its manifest. */
export interface CollectedEvidence {
  plan: EvidencePlan;
  /** The pulled versions, in the plan's order. */
  versions: PulledVersion[];
  /** The named obligations as the person's obligation history gives them. */
  obligations: PersonObligation[];
  manifest: ManifestItem[];
}

/** Evidence the declarations or documents service no longer holds. */
export class EvidenceMissing extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceMissing';
  }
}

/**
 * The records a referral's package includes, read in the caller's transaction under the tenant's
 * row-level security: every submitted version of the source cases, the selected flags, the
 * clarifications with their responses, the obligations, and the letters issued on them (the
 * clarifications' letters and every issued step of the ladders on the named clarifications,
 * obligations and actions).
 */
export async function planEvidence(
  tx: ReviewTransaction,
  referral: ReferralRow,
): Promise<EvidencePlan> {
  const { caseIds, flagIds, clarificationIds, obligationIds, actionIds } = referral.sources;
  const cases =
    caseIds.length === 0
      ? []
      : await tx
          .select({
            id: reviewCases.id,
            declarationId: reviewCases.declarationId,
            reference: reviewCases.reference,
          })
          .from(reviewCases)
          .where(inArray(reviewCases.id, caseIds));
  const caseById = new Map(cases.map((row) => [row.id, row]));
  const versions =
    caseIds.length === 0
      ? []
      : await tx
          .select({ caseId: reviewCaseVersions.caseId, version: reviewCaseVersions.version })
          .from(reviewCaseVersions)
          .where(inArray(reviewCaseVersions.caseId, caseIds))
          .orderBy(asc(reviewCaseVersions.caseId), asc(reviewCaseVersions.version));
  const flags =
    flagIds.length === 0
      ? []
      : await tx
          .select()
          .from(reviewFlags)
          .where(inArray(reviewFlags.id, flagIds))
          .orderBy(asc(reviewFlags.createdAt), asc(reviewFlags.id));
  const clarificationRows =
    clarificationIds.length === 0
      ? []
      : await tx
          .select({ clarification: clarifications, response: clarificationResponses })
          .from(clarifications)
          .leftJoin(
            clarificationResponses,
            eq(clarificationResponses.clarificationId, clarifications.id),
          )
          .where(inArray(clarifications.id, clarificationIds))
          .orderBy(asc(clarifications.issuedAt), asc(clarifications.id));
  const ladders =
    obligationIds.length + clarificationIds.length === 0
      ? []
      : await tx
          .select({
            subjectId: enforcementLadders.subjectId,
            subjectReference: enforcementLadders.subjectReference,
          })
          .from(enforcementLadders)
          .where(inArray(enforcementLadders.subjectId, [...obligationIds, ...clarificationIds]));
  const cycleKeys = new Map(ladders.map((row) => [row.subjectId, row.subjectReference]));
  const actions =
    actionIds.length === 0
      ? []
      : await tx
          .select({
            documentId: administrativeActions.letterDocumentId,
            reference: administrativeActions.reference,
          })
          .from(administrativeActions)
          .where(
            and(
              inArray(administrativeActions.id, actionIds),
              isNotNull(administrativeActions.letterDocumentId),
              isNotNull(administrativeActions.reference),
            ),
          )
          .orderBy(asc(administrativeActions.issuedAt), asc(administrativeActions.id));
  const letters: PlannedLetter[] = [
    ...clarificationRows.flatMap(({ clarification }) =>
      clarification.letterDocumentId !== null && clarification.reference !== null
        ? [{ documentId: clarification.letterDocumentId, reference: clarification.reference }]
        : [],
    ),
    ...actions.flatMap(({ documentId, reference }) =>
      documentId !== null && reference !== null ? [{ documentId, reference }] : [],
    ),
  ];
  return {
    versions: versions.flatMap(({ caseId, version }) => {
      const found = caseById.get(caseId);
      return found
        ? [{ caseId, declarationId: found.declarationId, version, reference: found.reference }]
        : [];
    }),
    flags: flags.map((flag) => ({
      ...flag,
      caseReference: caseById.get(flag.caseId)?.reference ?? flag.caseId,
    })),
    clarifications: clarificationRows,
    obligations: obligationIds.map((obligationId) => ({
      obligationId,
      cycleKey: cycleKeys.get(obligationId) ?? null,
    })),
    letters,
  };
}

/** The package as a supervisor previews it before approving: what it will include, by reference. */
export function evidencePreview(plan: EvidencePlan): EvidencePreviewItem[] {
  return [
    ...plan.versions.map((version) => ({
      kind: 'declaration-version' as const,
      reference: versionReference(version),
    })),
    ...plan.flags.map((flag) => ({ kind: 'flag' as const, reference: flagReference(flag) })),
    ...plan.clarifications.map(({ clarification }) => ({
      kind: 'clarification' as const,
      reference: clarification.reference ?? clarification.id,
    })),
    ...plan.obligations.map((obligation) => ({
      kind: 'obligation' as const,
      reference: obligation.cycleKey ?? obligation.obligationId,
    })),
    ...plan.letters.map((letter) => ({ kind: 'letter' as const, reference: letter.reference })),
  ];
}

/** The services the evidence is pulled from. */
export interface EvidenceSources {
  declarations: DeclarationsClient;
  documents: DocumentsClient;
}

/**
 * Pulls the plan's content and hashes every item: each version's declaration.v1 document from
 * declarations (read as the service, for its case, which declarations audits) and its attachments'
 * hashes; each flag, clarification (with its response) and obligation as canonical JSON; the
 * response attachments' and letters' own hashes from documents. Unreachable services propagate
 * (the activity retries); evidence no longer held is `EvidenceMissing`.
 */
export async function collectEvidence(
  { declarations, documents }: EvidenceSources,
  referral: ReferralRow,
  plan: EvidencePlan,
): Promise<CollectedEvidence> {
  const { tenant } = referral;
  const manifest: ManifestItem[] = [];
  const versions: PulledVersion[] = [];
  for (const planned of plan.versions) {
    const pulled = await declarations.getVersionDocument(planned.declarationId, planned.version, {
      tenant,
      actingSubject: SYSTEM_SUBJECT,
      caseId: planned.caseId,
    });
    if (!pulled) {
      throw new EvidenceMissing(
        `Declarations no longer holds version ${String(planned.version)} of ${planned.declarationId}`,
      );
    }
    versions.push(pulled);
    const reference = versionReference(planned);
    manifest.push(item('declaration-version', reference, digest(pulled.document)));
    pulled.attachments.forEach((attachment, index) => {
      manifest.push({
        kind: 'declaration-attachment',
        reference: `${reference} attachment ${String(index + 1)}`,
        sha256: attachment.sha256,
        documentId: attachment.uploadId,
      });
    });
  }
  for (const flag of plan.flags) {
    manifest.push(item('flag', flagReference(flag), digest(flagContent(flag))));
  }
  for (const { clarification, response } of plan.clarifications) {
    const reference = clarification.reference ?? clarification.id;
    manifest.push(
      item('clarification', reference, digest(clarificationContent(clarification, response))),
    );
    (response?.attachments ?? []).forEach((attachment, index) => {
      manifest.push({
        kind: 'clarification-attachment',
        reference: `${reference} attachment ${String(index + 1)}`,
        sha256: attachment.sha256,
        documentId: attachment.uploadId,
      });
    });
  }
  let obligations: PersonObligation[] = [];
  if (plan.obligations.length > 0) {
    const history = await declarations.listPersonObligations(referral.personId, tenant);
    const byId = new Map(history.map((entry) => [entry.obligationId, entry]));
    obligations = plan.obligations.map(({ obligationId }) => {
      const found = byId.get(obligationId);
      if (!found) throw new EvidenceMissing(`Declarations has no obligation ${obligationId}`);
      return found;
    });
    for (const obligation of obligations) {
      manifest.push(item('obligation', obligation.cycleKey, digest(obligation)));
    }
  }
  for (const letter of plan.letters) {
    const issued = await documents.getIssuedDocument(letter.documentId, tenant);
    if (!issued) throw new EvidenceMissing(`Documents has no document ${letter.documentId}`);
    manifest.push({
      kind: 'letter',
      reference: letter.reference,
      sha256: issued.sha256,
      documentId: letter.documentId,
    });
  }
  return { plan, versions, obligations, manifest };
}

/** A flag as the package includes it: what was observed, never more than the flag holds. */
export function flagContent(flag: FlagRow): Record<string, unknown> {
  return {
    id: flag.id,
    versionId: flag.versionId,
    ruleId: flag.ruleId,
    severity: flag.severity,
    title: flag.title,
    indicator: flag.indicator,
    evidence: flag.evidence,
    itemRefs: flag.itemRefs,
    reviewedAt: flag.reviewedAt?.toISOString() ?? null,
    reviewNote: flag.reviewNote,
  };
}

/** A clarification as the package includes it: the request and the declarant's response. */
export function clarificationContent(
  clarification: ClarificationRow,
  response: ClarificationResponseRow | null,
): Record<string, unknown> {
  return {
    id: clarification.id,
    reference: clarification.reference,
    status: clarification.status,
    items: clarification.items,
    issuedAt: clarification.issuedAt?.toISOString() ?? null,
    dueAt: clarification.dueAt?.toISOString() ?? null,
    respondedAt: clarification.respondedAt?.toISOString() ?? null,
    resolvedAt: clarification.resolvedAt?.toISOString() ?? null,
    resolutionNote: clarification.resolutionNote,
    response:
      response === null
        ? null
        : {
            items: response.items,
            attachments: response.attachments.map(({ itemId, uploadId, sha256 }) => ({
              itemId,
              uploadId,
              sha256,
            })),
            submittedAt: response.submittedAt.toISOString(),
          },
  };
}

function versionReference(version: { reference: string; version: number }): string {
  return `${version.reference} v${String(version.version)}`;
}

function flagReference(flag: { caseReference: string; ruleId: string }): string {
  return `${flag.caseReference} ${flag.ruleId}`;
}

function item(kind: ManifestKind, reference: string, sha256: string): ManifestItem {
  return { kind, reference, sha256, documentId: null };
}

/** SHA-256 (hex) of a value's canonical JSON: keys sorted, so equal content hashes equally. */
export function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** JSON with object keys in sorted order at every depth. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortKeys(entry)]),
    );
  }
  return value;
}
