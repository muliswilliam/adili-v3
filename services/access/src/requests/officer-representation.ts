import { z } from 'zod';

import type { LeaRequestStatus } from '../lea/schema.js';
import { ACCESS_REQUEST_STATUSES, type AccessRequestStatus } from './schema.js';

/**
 * What the Commission's access officer and supervisor work with besides the request itself: the
 * queue, and the roster records the officer named in a request may be resolved to.
 */

/** The kinds of request the queue holds: Form K, and law enforcement requests. */
export const QUEUE_KINDS = ['form-k', 'lea'] as const;

/**
 * The statuses of either kind: `AccessRequestStatus` and the law enforcement ones it lacks
 * (`granted`, `denied` and `withdrawn` are both kinds').
 */
export const QUEUE_STATUSES = [
  ...ACCESS_REQUEST_STATUSES,
  'received',
  'verified',
] as const satisfies readonly (AccessRequestStatus | LeaRequestStatus)[];
export type QueueStatus = AccessRequestStatus | LeaRequestStatus;

const isQueueStatus = (status: string): status is QueueStatus =>
  (QUEUE_STATUSES as readonly string[]).includes(status);

/** The statuses of `kind` among `statuses`. */
export function statusesOfKind<S extends QueueStatus>(
  statuses: readonly QueueStatus[],
  kind: readonly S[],
): S[] {
  return statuses.filter((status): status is S => (kind as readonly string[]).includes(status));
}

/** Query of `listCommissionAccessRequests`. */
export const queueQuery = z.object({
  status: z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') return undefined;
      const statuses = value.split(',').map((status) => status.trim());
      const unknown = statuses.filter((status) => !isQueueStatus(status));
      if (unknown.length > 0) {
        ctx.addIssue({ code: 'custom', message: `Unknown status: ${unknown.join(', ')}` });
        return z.NEVER;
      }
      return statuses.filter(isQueueStatus);
    })
    .meta({
      description:
        'Only requests in these statuses, comma-separated, of either kind (e.g. the open ones: `submitted,pending-applicant-verification,officer-unresolved,awaiting-representations,under-decision,received,verified`)',
    }),
  kind: z.enum(QUEUE_KINDS).optional().meta({ description: 'Only Form K or only LEA requests' }),
  cursor: z
    .string()
    .max(500)
    .optional()
    .meta({ description: '`nextCursor` of the previous page; omit for the first page' }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type QueueQuery = z.infer<typeof queueQuery>;

/** access.yaml `QueueItem`: one request in the Commission's queue. */
export const queueItemSchema = z.object({
  kind: z.enum(QUEUE_KINDS),
  id: z.uuid(),
  reference: z.string(),
  /** The applicant's name (Form K Part I), or the agency's name of a law enforcement request. */
  applicantOrAgency: z.string(),
  /** The officer sought, as the request names them. */
  officerSought: z.string(),
  /** The roster record's full name the officer sought was resolved to; null before. */
  resolvedName: z.string().nullable(),
  status: z.enum(QUEUE_STATUSES).meta({
    description:
      'An `AccessRequestStatus` for Form K, a `LeaRequestStatus` for law enforcement requests',
  }),
  submittedAt: z.iso.datetime({ offset: true }),
  /** The decision deadline. */
  deadlineAt: z.iso.datetime({ offset: true }),
  /** When the declarant's window for representations ends, once notified (Form K only). */
  windowEndsAt: z.iso.datetime({ offset: true }).nullable(),
  /** Past its decision deadline and not decided or closed. */
  late: z.boolean(),
});

export type QueueItem = z.infer<typeof queueItemSchema>;

export const queuePageSchema = z.object({
  items: z.array(queueItemSchema),
  nextCursor: z
    .string()
    .nullable()
    .meta({ description: 'Pass as `cursor` for the next page; null on the last page' }),
});

export type QueuePage = z.infer<typeof queuePageSchema>;

/** Body of `resolveRequestedOfficer`. */
export const resolveOfficerBody = z.strictObject({
  rosterRecordId: z.uuid().nullable().meta({
    description:
      'The roster record of the Commission the officer named in Part II is (an onboarded one: the declarant is notified); null records that they cannot be identified, which closes the request',
  }),
});

export type ResolveOfficerBody = z.infer<typeof resolveOfficerBody>;

/** Query of `listRosterCandidates`. */
export const rosterCandidatesQuery = z.object({
  q: z.string().trim().min(2).max(200).meta({
    description:
      'A personnel file number or its beginning, or part of a name (both case-insensitive)',
  }),
});

export type RosterCandidatesQuery = z.infer<typeof rosterCandidatesQuery>;

/** A roster record of the Commission the officer named in a request may be resolved to. */
export const rosterCandidateSchema = z.object({
  id: z.uuid(),
  personnelFileNumber: z.string(),
  fullName: z.string(),
  designation: z.string().nullable(),
  reportingEntity: z.string().nullable().meta({ description: 'Its name' }),
  state: z
    .string()
    .meta({ description: 'The roster record state: not_onboarded, onboarded, exited' }),
  /**
   * The officer has a declarant account: only then can they be notified, so only an onboarded
   * record can be chosen.
   */
  onboarded: z.boolean(),
});

export type RosterCandidate = z.infer<typeof rosterCandidateSchema>;

export const rosterCandidatesSchema = z.object({
  items: z.array(rosterCandidateSchema).meta({ description: 'By full name, at most 20' }),
});

export type RosterCandidates = z.infer<typeof rosterCandidatesSchema>;
