import type { FormKV1 } from '@adili/forms';
import { z } from 'zod';

import { decisionSchema } from '../decision.js';
import type { LeaRequestRow } from '../lea/representation.js';
import {
  representationsSchema,
  type RepresentationsRow,
  toRepresentations,
} from '../requests/officer-view.js';
import {
  accessRequestStatusSchema,
  type AccessRequestRow,
  commissionRefSchema,
} from '../requests/representation.js';
import { REPRESENTATION_STANCES } from '../requests/schema.js';
import { scopeSchema } from '../scope.js';

/** Most attachments one submission of representations carries. */
export const MAX_REPRESENTATION_ATTACHMENTS = 10;

/** Body of `submitRepresentations` (access.yaml `RepresentationsInput`). */
export const representationsInputSchema = z
  .strictObject({
    stance: z.enum(REPRESENTATION_STANCES).meta({
      description:
        '`object` to the disclosure, `consent` to it (the request goes under decision at once), or add `context`',
    }),
    text: z
      .string()
      .trim()
      .max(8000)
      .meta({ description: "The declarant's representations; may be empty only with `consent`" }),
    attachments: z
      .array(z.uuid())
      .max(MAX_REPRESENTATION_ATTACHMENTS)
      .meta({ description: 'Clean uploads of purpose `access-representation` by the declarant' }),
  })
  .superRefine((input, ctx) => {
    if (input.stance !== 'consent' && input.text === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'is required to object or add context',
      });
    }
    const seen = new Set<string>();
    input.attachments.forEach((uploadId, index) => {
      if (seen.has(uploadId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['attachments', index],
          message: 'is attached twice',
        });
      }
      seen.add(uploadId);
    });
  });

export type RepresentationsInput = z.infer<typeof representationsInputSchema>;

/**
 * access.yaml `DeclarantNotice`: a request about the declarant they have been notified of, with
 * who asked, why, for what, until when they may respond, what they said and what was decided. A
 * law enforcement request appears once granted and the declarant told (r.23(2)), with its agency
 * and case reference; it takes no representations.
 */
export const declarantNoticeSchema = z.object({
  requestId: z.uuid(),
  reference: z.string(),
  kind: z.enum(['form-k', 'lea']),
  commission: commissionRefSchema,
  status: accessRequestStatusSchema,
  /** The applicant's name (Form K Part I); the agency of a law enforcement request, once granted. */
  applicantName: z.string(),
  /** Why the applicant asks (Form K Part III reason); for law enforcement, in general terms only. */
  purposeInGeneralTerms: z.string(),
  agency: z.object({ code: z.string(), name: z.string() }).nullable().meta({
    description: 'The agency of a law enforcement request (from its grant); null for Form K',
  }),
  caseReference: z.string().nullable().meta({
    description:
      "The agency's case reference of a law enforcement request (from its grant); null for Form K",
  }),
  scope: scopeSchema,
  notifiedAt: z.iso.datetime({ offset: true }),
  windowEndsAt: z.iso.datetime({ offset: true }).nullable(),
  /** The window is open: representations can be made or changed now. */
  canRespond: z.boolean(),
  representations: representationsSchema.nullable(),
  decision: decisionSchema.nullable(),
});

export type DeclarantNotice = z.infer<typeof declarantNoticeSchema>;

/** Whether the declarant may make or change representations on the request at `now`. */
export function windowOpen(row: AccessRequestRow, now: Date): boolean {
  return (
    row.status === 'awaiting-representations' &&
    row.windowEndsAt !== null &&
    now.getTime() < row.windowEndsAt.getTime()
  );
}

export function toDeclarantNotice(
  row: AccessRequestRow,
  formK: FormKV1,
  representationsRow: RepresentationsRow | null,
  now: Date,
): DeclarantNotice {
  if (row.notifiedAt === null) throw new Error(`Request ${row.id} is not notified`);
  return {
    requestId: row.id,
    reference: row.reference,
    kind: 'form-k',
    commission: { slug: row.tenant, name: row.commissionName },
    status: row.status,
    applicantName: row.applicantName,
    purposeInGeneralTerms: formK.partIII.reason,
    agency: null,
    caseReference: null,
    scope: row.scope,
    notifiedAt: row.notifiedAt.toISOString(),
    windowEndsAt: row.windowEndsAt?.toISOString() ?? null,
    canRespond: windowOpen(row, now),
    representations: representationsRow === null ? null : toRepresentations(representationsRow),
    decision: row.decision,
  };
}

/**
 * The purpose of a law enforcement request in general terms: the reason the agency gave stays
 * between it and the Commission, as telling it could prejudice the investigation (Reg 24(b)).
 */
export const LEA_PURPOSE_IN_GENERAL_TERMS =
  'An investigation by a law enforcement agency (Conflict of Interest Act, s.36(2))';

/** A granted law enforcement request the declarant has been told of (r.23(2)). */
export function toLeaDeclarantNotice(row: LeaRequestRow): DeclarantNotice {
  if (row.declarantNotifiedAt === null) throw new Error(`Request ${row.id} is not notified`);
  return {
    requestId: row.id,
    reference: row.reference,
    kind: 'lea',
    commission: { slug: row.tenant, name: row.commissionName },
    status: 'granted',
    applicantName: row.agencyName,
    purposeInGeneralTerms: LEA_PURPOSE_IN_GENERAL_TERMS,
    agency: { code: row.agencyCode, name: row.agencyName },
    caseReference: row.caseReference,
    scope: row.scope,
    notifiedAt: row.declarantNotifiedAt.toISOString(),
    windowEndsAt: null,
    canRespond: false,
    representations: null,
    decision: row.decision,
  };
}
