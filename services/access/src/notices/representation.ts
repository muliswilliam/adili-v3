import type { FormKV1 } from '@adili/forms';
import { z } from 'zod';

import { decisionSchema } from '../decision.js';
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
 * who asked, why, for what, until when they may respond, what they said and what was decided.
 */
export const declarantNoticeSchema = z.object({
  requestId: z.uuid(),
  reference: z.string(),
  kind: z.enum(['form-k', 'lea']),
  commission: commissionRefSchema,
  status: accessRequestStatusSchema,
  /** The applicant's name (Form K Part I); the agency of a law enforcement request, once granted. */
  applicantName: z.string(),
  /** Why the applicant asks (Form K Part III reason). */
  purposeInGeneralTerms: z.string(),
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
    scope: row.scope,
    notifiedAt: row.notifiedAt.toISOString(),
    windowEndsAt: row.windowEndsAt?.toISOString() ?? null,
    canRespond: windowOpen(row, now),
    representations: representationsRow === null ? null : toRepresentations(representationsRow),
    decision: row.decision,
  };
}
