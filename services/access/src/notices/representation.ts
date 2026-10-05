import type { FormKV1 } from '@adili/forms';
import { z } from 'zod';

import { publicDecision, publicDecisionSchema } from '../decision.js';
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
    attachments: z.array(z.uuid()).max(MAX_REPRESENTATION_ATTACHMENTS).meta({
      description:
        'Clean uploads of purpose `access-representation` by the caller (the declarant; the access officer for representations received in writing), or ones attached already',
    }),
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

/** How the declarant was told of a request: online, or in writing while they had no account. */
const noticeChannelSchema = z.enum(['online', 'written']).meta({
  description:
    'How the declarant was told: `online` at their account, or `written`: a notice served on paper while they had no account (spec 10 decision 2), `notifiedAt` the start of the day it was served',
});

/**
 * access.yaml `FormKDeclarantNotice`: a Form K request about the declarant they have been notified
 * of, with who asked, why (the applicant's reason, verbatim), for what, until when they may
 * respond, what they said and what was decided.
 */
export const formKDeclarantNoticeSchema = z.object({
  requestId: z.uuid(),
  reference: z.string(),
  kind: z.literal('form-k'),
  commission: commissionRefSchema,
  status: accessRequestStatusSchema,
  /** The applicant's name (Form K Part I). */
  applicantName: z.string(),
  /** Why the applicant asks: Form K Part III's reason, verbatim. */
  purposeInGeneralTerms: z.string(),
  scope: scopeSchema,
  notifiedAt: z.iso.datetime({ offset: true }),
  noticeChannel: noticeChannelSchema,
  windowEndsAt: z.iso.datetime({ offset: true }).nullable(),
  /** The window is open: representations can be made or changed now. */
  canRespond: z.boolean(),
  representations: representationsSchema.nullable(),
  decision: publicDecisionSchema.nullable(),
});

export type FormKDeclarantNotice = z.infer<typeof formKDeclarantNoticeSchema>;

/**
 * access.yaml `DeclarantNotice`: a request about the declarant they are told of, by `kind`. Only
 * Form K requests: a law enforcement request is never the declarant's to see (product decision,
 * 2026-10-05; #614).
 */
export const declarantNoticeSchema = z.discriminatedUnion('kind', [formKDeclarantNoticeSchema]);

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
): FormKDeclarantNotice {
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
    noticeChannel: row.writtenNotice === null ? 'online' : 'written',
    windowEndsAt: row.windowEndsAt?.toISOString() ?? null,
    canRespond: windowOpen(row, now),
    representations:
      representationsRow === null ? null : toRepresentations(representationsRow, 'declarant'),
    decision: publicDecision(row.decision),
  };
}
