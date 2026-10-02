import {
  ACCESS_OUTCOMES,
  ACCESS_SUBJECT_KINDS,
  type AccessOutcome,
  type AccessRegisterKind,
} from '@adili/events/contracts';
import { z } from 'zod';

import { outcomeSchema, PACKAGE_KINDS, type PackageKind } from '../decision.js';

import {
  registerEntrySchema,
  type TimelineRow,
  toRegisterEntry,
} from '../register/representation.js';
import { commissionRefSchema } from '../requests/representation.js';
import { type Scope, scopeSchema } from '../scope.js';

/**
 * What the declarant sees of each kind of subject (spec 10 S12): a Form K request from the moment
 * they were notified (r.22, Act s.36(3)), a law enforcement request only once granted (r.23(2)),
 * and their certified copies. Steps before those (receipt, verification) and a request closed
 * before it reached them never show.
 */
export const FORM_K_VISIBLE_KINDS: readonly AccessRegisterKind[] = [
  'notified',
  'representations',
  'decided',
  'decision-notified',
  'package-issued',
  'downloaded',
  'expired',
  'withdrawn',
];
export const LEA_VISIBLE_KINDS: readonly AccessRegisterKind[] = [
  'decided',
  'package-issued',
  'downloaded',
  'expired',
];

/** The certified copy a `self-access` entry records. */
export const historyCertifiedCopySchema = z.object({
  id: z.uuid(),
  declarationId: z.uuid(),
  version: z.int().min(1),
  /** The Restricted `certified-copy` document, downloadable by the declarant from documents. */
  documentId: z.uuid().nullable(),
  /** Who applied on the declarant's behalf (an officer-recorded application); null otherwise. */
  representativeName: z.string().nullable(),
});

/**
 * access.yaml `AccessHistoryEntry`: one step of "who accessed my declaration", a register entry
 * as the declarant may see it. Staff and law enforcement officers are never named: `actor` is
 * the applicant on their own steps (download, withdrawal) and null otherwise; who sought access
 * is `requester` (the applicant, or the law enforcement agency).
 */
export const accessHistoryEntrySchema = registerEntrySchema.extend({
  subjectKind: z.enum(ACCESS_SUBJECT_KINDS),
  /** The access request, law enforcement request or certified copy. */
  subjectId: z.uuid(),
  /** The request's `ARQ` or `LEA` reference; the declaration's for a certified copy. */
  reference: z.string(),
  commission: commissionRefSchema,
  /** The applicant (Form K) or the agency (law enforcement); null for a certified copy. */
  requester: z.string().nullable(),
  /** The agency's case reference (law enforcement); null otherwise. */
  caseReference: z.string().nullable(),
  /**
   * Why the applicant asked, as the notice told the declarant (Form K Part III's reason); null
   * for a law enforcement request (its reason is never told, decision 4) and a certified copy.
   */
  purposeInGeneralTerms: z.string().nullable(),
  /**
   * What the request reaches: for Form K the scope requested on steps before the decision, the
   * scope granted on the decision and the steps after it (null after a denial); for a law
   * enforcement request (shown only once granted) the scope granted, what was disclosed; null for
   * a certified copy.
   */
  scope: scopeSchema.nullable(),
  /** A `decided` entry's outcome; null for every other kind. */
  outcome: outcomeSchema.nullable(),
  /** A `self-access` entry's certified copy; null for every other kind. */
  certifiedCopy: historyCertifiedCopySchema.nullable(),
  /**
   * What the grant delivered, on a `package-issued`, `downloaded` or `expired` entry: the access
   * package, or the nil letter saying the Commission holds no declaration within the granted
   * scope (decision 1); null for every other kind.
   */
  packageKind: z.enum(PACKAGE_KINDS).nullable(),
});

export type AccessHistoryEntry = z.infer<typeof accessHistoryEntrySchema>;

/** What the declarant may know of the subject an entry is about. */
export interface HistorySubject {
  reference: string;
  commission: { slug: string; name: string };
  requester: string | null;
  caseReference: string | null;
  /** Form K only: the applicant's stated reason; null otherwise. */
  purposeInGeneralTerms: string | null;
  /**
   * The request's scope requested and, once decided, the scope granted (null on a denial); null
   * for a certified copy.
   */
  scopes: { requested: Scope; decided: boolean; granted: Scope | null } | null;
  /** What the request's grant delivered; null before (or without) one, and for a certified copy. */
  packageKind: PackageKind | null;
}

/** Register kinds about the grant's package (or nil letter). */
const PACKAGE_ENTRY_KINDS: readonly AccessRegisterKind[] = [
  'package-issued',
  'downloaded',
  'expired',
];

/** The plain-language line of a step about a nil letter rather than a package. */
const NIL_LETTER_SUMMARIES: Partial<Record<AccessRegisterKind, string>> = {
  'package-issued': 'Nil letter issued',
  downloaded: 'Nil letter downloaded',
};

/** Register kinds from the decision on: their scope is the one granted. */
const DECIDED_KINDS: readonly AccessRegisterKind[] = [
  'decided',
  'decision-notified',
  ...PACKAGE_ENTRY_KINDS,
];

/** Register kinds the applicant themselves acts on, named to the declarant (Form K only). */
const APPLICANT_KINDS: readonly AccessRegisterKind[] = ['downloaded', 'withdrawn'];

export function toAccessHistoryEntry(
  row: TimelineRow,
  subject: HistorySubject,
): AccessHistoryEntry {
  const details = row.details;
  const entry = toRegisterEntry(row);
  const packageKind = PACKAGE_ENTRY_KINDS.includes(row.kind) ? subject.packageKind : null;
  return {
    ...entry,
    summary:
      (packageKind === 'nil-letter' ? NIL_LETTER_SUMMARIES[row.kind] : undefined) ?? entry.summary,
    packageKind,
    subjectKind: row.subjectKind,
    subjectId: row.subjectId,
    reference: subject.reference,
    commission: subject.commission,
    requester: subject.requester,
    caseReference: subject.caseReference,
    purposeInGeneralTerms: subject.purposeInGeneralTerms,
    scope: scopeOf(row.kind, subject.scopes),
    actor:
      row.subjectKind === 'access-request' && APPLICANT_KINDS.includes(row.kind)
        ? (row.actorName ?? null)
        : null,
    outcome: row.kind === 'decided' ? outcomeOf(details.outcome) : null,
    certifiedCopy:
      row.kind === 'self-access'
        ? {
            id: row.subjectId,
            declarationId: String(details.declarationId),
            version: Number(details.version),
            documentId: typeof details.documentId === 'string' ? details.documentId : null,
            representativeName:
              typeof details.representativeName === 'string' ? details.representativeName : null,
          }
        : null,
  };
}

function scopeOf(kind: AccessRegisterKind, scopes: HistorySubject['scopes']): Scope | null {
  if (scopes === null) return null;
  return scopes.decided && DECIDED_KINDS.includes(kind) ? scopes.granted : scopes.requested;
}

function outcomeOf(value: unknown): AccessOutcome | null {
  return (ACCESS_OUTCOMES as readonly unknown[]).includes(value) ? (value as AccessOutcome) : null;
}
