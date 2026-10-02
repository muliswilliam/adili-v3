import { TENANT_KEY } from '@adili/api-kit';
import { z } from 'zod';

import { decisionSchema, packageFailedAtSchema, packageSchema } from '../decision.js';
import { type RegisterEntry, registerEntrySchema } from '../register/representation.js';
import { packageOf } from '../requests/representation.js';
import { scopeSchema } from '../scope.js';
import { LEA_REQUEST_STATUSES, type leaRequests } from './schema.js';
import { noticeOf, noticeSchema } from '../written-notice.js';

/**
 * Shapes of the law enforcement requests API (spec 10, Act s.36(2), Regs r.23). They are the
 * contract: packages/schemas/internal/access.yaml is generated from these schemas.
 */

export const leaRequestStatusSchema = z.enum(LEA_REQUEST_STATUSES).meta({
  description:
    '`received` with its LEA reference; `verified` once the access officer checked its provenance and reason and identified the officer sought; `granted` (in full or in part: see the decision) or `denied`, final; `withdrawn`',
});

/** The officer whose declaration is sought, as the request names them. */
export const leaOfficerSoughtSchema = z.strictObject({
  name: z.string().trim().min(2).max(200),
  entity: z.string().trim().max(200).optional(),
  workStation: z.string().trim().max(200).optional(),
  personnelFileNumber: z.string().trim().max(30).optional(),
});

/** Body of `submitLeaRequest`: the written request (r.23(1)); no Form K. */
export const leaRequestInputSchema = z.strictObject({
  commission: z
    .string()
    .regex(TENANT_KEY)
    .meta({ description: 'The Responsible Commission addressed (its slug)' }),
  officerSought: leaOfficerSoughtSchema,
  reason: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .meta({ description: 'What is being investigated and why the declaration is needed' }),
  caseReference: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .meta({ description: "The agency's case reference: one request per case" }),
  scope: scopeSchema.refine((scope) => !scope.includeClarifications, {
    path: ['includeClarifications'],
    message: 'must be false: law enforcement requests do not include clarifications',
  }),
});

export type LeaRequestInput = z.infer<typeof leaRequestInputSchema>;

/** Body of `verifyLeaRequest`: the access officer's check (r.23(1)) and the officer identified. */
export const verifyLeaRequestBody = z.strictObject({
  provenanceConfirmed: z.literal(true).meta({
    description: 'The access officer confirms the request comes from the agency account it shows',
  }),
  reasonConfirmed: z
    .literal(true)
    .meta({ description: 'The access officer confirms the request states its reason' }),
  rosterRecordId: z.uuid().meta({
    description:
      'The roster record of the Commission the officer sought is: their declarant is told after a grant (online, or in writing when they have no account)',
  }),
  note: z.string().trim().min(1).max(1000).meta({ description: 'What the access officer checked' }),
});

export type VerifyLeaRequestBody = z.infer<typeof verifyLeaRequestBody>;

/** The filing officer's account as the directory held it when checked (r.23(1)). */
export const leaProvenanceSchema = z.object({
  accountState: z.enum(['invited', 'activated']),
  activatedAt: z.iso
    .datetime({ offset: true })
    .nullable()
    .meta({ description: "The account's first sign-in; null while invited" }),
  agencyLegalBasis: z.string().meta({ description: 'The statute that empowers the agency' }),
  checkedAt: z.iso.datetime({ offset: true }),
});

export const leaVerificationSchema = z.object({
  by: z.object({ subject: z.string(), name: z.string() }),
  at: z.iso.datetime({ offset: true }),
  note: z.string(),
  provenance: leaProvenanceSchema.meta({ description: 'As confirmed when verified' }),
});

/**
 * access.yaml `LeaRequest`: a law enforcement request as its officer and the Commission's access
 * officer and supervisor see it.
 */
export const leaRequestSchema = z.object({
  id: z.uuid(),
  reference: z.string().meta({ description: 'LEA-<ISSUER>-<YEAR>-<seq>-<check>' }),
  commission: z.object({ slug: z.string(), name: z.string() }),
  agency: z.object({ code: z.string(), name: z.string() }),
  officer: z
    .object({ subject: z.string(), name: z.string() })
    .meta({ description: 'The law enforcement officer who filed it' }),
  provenance: leaProvenanceSchema.meta({ description: "The officer's account at receipt" }),
  officerSought: leaOfficerSoughtSchema,
  reason: z.string(),
  caseReference: z.string(),
  scope: scopeSchema,
  status: leaRequestStatusSchema,
  receivedAt: z.iso.datetime({ offset: true }),
  deadlineAt: z.iso
    .datetime({ offset: true })
    .meta({ description: 'Received + 14 days: the decision is due by then' }),
  breachedAt: z.iso.datetime({ offset: true }).nullable().meta({
    description:
      'Set when the fourteen-day deadline passed with the request undecided (the breach flag); null otherwise',
  }),
  resolvedRosterRecordId: z.uuid().nullable(),
  resolvedName: z
    .string()
    .nullable()
    .meta({ description: 'The roster record the officer sought was identified as' }),
  verification: leaVerificationSchema.nullable(),
  decision: decisionSchema.nullable(),
  declarantNotifiedAt: z.iso.datetime({ offset: true }).nullable().meta({
    description: 'When the declarant was told of the grant (only after a grant, r.23(2))',
  }),
  declarantOnboarded: z.boolean().nullable().meta({
    description:
      "Whether the officer identified has a declarant account (told of a grant online); false: told in writing, and invited to onboard (spec 10 decision 2); null until verified, and for the agency's officer",
  }),
  declarantInvitedAt: z.iso.datetime({ offset: true }).nullable().meta({
    description:
      "When the officer with no account was invited to onboard; null when not invited, and for the agency's officer",
  }),
  declarantNotice: noticeSchema.nullable().meta({
    description:
      "How and when the declarant was told of the grant; null before, and for the agency's officer",
  }),
  package: packageSchema.nullable(),
  packageFailedAt: packageFailedAtSchema,
  timeline: z.array(registerEntrySchema),
});

export type LeaRequest = z.infer<typeof leaRequestSchema>;

export type LeaRequestRow = typeof leaRequests.$inferSelect;

/**
 * The API shape of a law enforcement request, with its register entries, oldest first. The
 * agency's officer does not see how the declarant's account and notice stand.
 */
export function toLeaRequest(
  row: LeaRequestRow,
  timeline: readonly RegisterEntry[],
  audience: 'commission' | 'lea-officer' = 'lea-officer',
): LeaRequest {
  const commission = audience === 'commission';
  const downloads = timeline.filter((entry) => entry.kind === 'downloaded').length;
  const { verification } = row;
  return {
    id: row.id,
    reference: row.reference,
    commission: { slug: row.tenant, name: row.commissionName },
    agency: { code: row.agencyCode, name: row.agencyName },
    officer: { subject: row.officerSubject, name: row.officerName },
    provenance: row.provenance,
    officerSought: row.officerSought,
    reason: row.reason,
    caseReference: row.caseReference,
    scope: row.scope,
    status: row.status,
    receivedAt: row.receivedAt.toISOString(),
    deadlineAt: row.deadlineAt.toISOString(),
    breachedAt: row.breachedAt?.toISOString() ?? null,
    resolvedRosterRecordId: row.resolvedRosterRecordId,
    resolvedName: row.resolvedName,
    verification:
      verification === null
        ? null
        : {
            by: { subject: verification.by, name: verification.byName },
            at: verification.at,
            note: verification.note,
            provenance: verification.provenance,
          },
    decision: row.decision,
    declarantNotifiedAt: row.declarantNotifiedAt?.toISOString() ?? null,
    declarantOnboarded:
      commission && row.resolvedRosterRecordId !== null ? row.resolvedPersonId !== null : null,
    declarantInvitedAt: commission ? (row.declarantInvitedAt?.toISOString() ?? null) : null,
    declarantNotice: commission ? noticeOf(row.declarantNotifiedAt, row.writtenNotice) : null,
    package: packageOf(row, downloads),
    packageFailedAt: row.packageFailedAt?.toISOString() ?? null,
    timeline: [...timeline],
  };
}
