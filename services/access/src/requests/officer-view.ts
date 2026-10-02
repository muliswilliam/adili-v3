import type { FormKV1 } from '@adili/forms';
import { z } from 'zod';

import { DirectoryClient, DirectoryUnavailable } from '../directory/directory-client.js';
import type { RegisterEntry } from '../register/representation.js';
import { type AccessRequestRow, accessRequestSchema, toAccessRequest } from './representation.js';
import {
  APPLICANT_IDENTITY_STATUSES,
  REPRESENTATION_STANCES,
  type representations,
} from './schema.js';

/** access.yaml `Representations`: the declarant's representations on a request. */
export const representationsSchema = z.object({
  stance: z.enum(REPRESENTATION_STANCES),
  text: z.string(),
  attachments: z.array(z.object({ uploadId: z.uuid(), fileName: z.string() })),
  submittedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type Representations = z.infer<typeof representationsSchema>;

/**
 * access.yaml `OfficerRequestView`: a request as the Commission's access officer and supervisor
 * see it, with whether the applicant's identity is verified, the roster record the officer named
 * was resolved to, the declarant's representations and their window.
 */
export const officerRequestViewSchema = accessRequestSchema.extend({
  applicantIdentityStatus: z.enum(APPLICANT_IDENTITY_STATUSES),
  resolvedRosterRecordId: z.uuid().nullable(),
  /** The roster record's full name and personnel file number, as the roster had them then. */
  resolvedName: z.string().nullable(),
  resolvedFileNumber: z.string().nullable(),
  representations: representationsSchema.nullable(),
  windowEndsAt: z.iso.datetime({ offset: true }).nullable(),
  representationWindowDays: z.int().positive().nullable().meta({
    description:
      "Days the declarant would have for representations if notified now (the Commission's policy in force), for the access officer identifying the officer; null once notified (see `windowEndsAt`), or when the policy cannot be read",
  }),
});

export type OfficerRequestView = z.infer<typeof officerRequestViewSchema>;

export type RepresentationsRow = typeof representations.$inferSelect;

export function toRepresentations(row: RepresentationsRow): Representations {
  return {
    stance: row.stance,
    text: row.text,
    attachments: row.attachments.map(({ uploadId, fileName }) => ({ uploadId, fileName })),
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The representation window of the Commission's policy in force, for the access officer about to
 * identify the officer; null when the directory cannot be reached (the view still loads).
 */
export async function representationWindowDays(
  directory: DirectoryClient,
  tenant: string,
): Promise<number | null> {
  try {
    return (await directory.accessPolicy(tenant)).representationWindowDays;
  } catch (error) {
    if (error instanceof DirectoryUnavailable) return null;
    throw error;
  }
}

/** The officer's view of a request, with its decrypted Form K and its whole timeline. */
export function toOfficerRequestView(
  row: AccessRequestRow,
  formK: FormKV1,
  timeline: readonly RegisterEntry[],
  representationsRow: RepresentationsRow | null,
  representationWindowDays: number | null,
): OfficerRequestView {
  return {
    ...toAccessRequest(row, formK, timeline),
    applicantIdentityStatus: row.applicantIdentityStatus,
    resolvedRosterRecordId: row.resolvedRosterRecordId,
    resolvedName: row.resolvedName,
    resolvedFileNumber: row.resolvedFileNumber,
    representations: representationsRow === null ? null : toRepresentations(representationsRow),
    windowEndsAt: row.windowEndsAt?.toISOString() ?? null,
    representationWindowDays: row.notifiedAt === null ? representationWindowDays : null,
  };
}
