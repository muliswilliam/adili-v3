import { z } from 'zod';

import { slugSchema } from '../../commissions/create-commission.js';
import { ofrSchema } from '../../onboarding/representation.js';
import { importChannelSchema } from '../import/representation.js';
import { ROSTER_RECORD_STATES } from '../schema.js';

/**
 * Response shapes of the roster records endpoints (spec #27). They are the contract: the OpenAPI
 * document is generated from them.
 */

export const rosterRecordStateSchema = z.enum(ROSTER_RECORD_STATES).meta({
  description:
    '`not_onboarded` until the declarant onboards against the record (slice 03); `exited` once an exit is recorded',
});

export const reportingEntityRefSchema = z.object({
  id: z.uuid(),
  name: z.string().meta({ description: 'As first written in a roster row' }),
});

export const rosterRecordListItemSchema = z.object({
  id: z.uuid(),
  personnelFileNumber: z.string(),
  fullName: z.string(),
  nationalIdMasked: z.string().meta({
    description: 'All but the last three digits replaced, e.g. •••••123',
    examples: ['•••••123'],
  }),
  designation: z.string().nullable(),
  jobGroup: z.string().nullable(),
  reportingEntity: reportingEntityRefSchema.nullable(),
  state: rosterRecordStateSchema,
  absentFromLatestImport: z.boolean().meta({
    description:
      'Not in the latest complete import; stays set until an exit is confirmed or the record is kept',
  }),
  flaggedByImportId: z
    .uuid()
    .nullable()
    .meta({ description: 'The complete import that flagged the record; null when not flagged' }),
  flaggedAt: z.iso.datetime().nullable().meta({ description: 'When the record was flagged' }),
  ofr: ofrSchema
    .nullable()
    .meta({ description: "The declarant's officer reference once onboarded; null before" }),
  onboardedAt: z.iso
    .datetime()
    .nullable()
    .meta({ description: 'When the declarant onboarded against the record; null before' }),
  identityMismatchAt: z.iso.datetime().nullable().meta({
    description:
      "When an onboarding attempt found that IPRS does not confirm the record's name; null when none has",
  }),
});
export type RosterRecordListItem = z.infer<typeof rosterRecordListItemSchema>;

export const rosterRecordImportSchema = z.object({
  importId: z.uuid(),
  startedAt: z.iso.datetime(),
  outcome: z.enum(['created', 'updated', 'unchanged', 'rejected']).meta({
    description:
      "What the import's row did to the record; `rejected` when it would have changed the identity of an onboarded record",
  }),
});
export type RosterRecordImport = z.infer<typeof rosterRecordImportSchema>;

export const rosterRecordSchema = rosterRecordListItemSchema.extend({
  nationalId: z.string().meta({ description: 'Full value, digits only; reads are audited' }),
  appointmentDate: z.iso.date().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable().meta({ description: 'E.164' }),
  exitDate: z.iso.date().nullable(),
  source: importChannelSchema.meta({ description: 'Channel of the last change' }),
  firstSeenImportId: z.uuid(),
  lastSeenImportId: z.uuid().meta({
    description: 'The latest import with a row for this record, whether or not it changed it',
  }),
  imports: z.array(rosterRecordImportSchema).meta({
    description:
      'Imports with a row for this record, newest first; at most the latest 50, from the import rows kept (rows are purged after 30 days)',
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type RosterRecord = z.infer<typeof rosterRecordSchema>;

export const rosterRecordPageSchema = z.object({
  items: z.array(rosterRecordListItemSchema),
  nextCursor: z
    .string()
    .nullable()
    .meta({ description: 'Pass as `cursor` for the next page; null on the last page' }),
});
export type RosterRecordPage = z.infer<typeof rosterRecordPageSchema>;

/**
 * A roster record as services pull it after a directory event (spec 04): what their read models
 * keep, with the Commission it belongs to. No national ID (the review service alone reads it, from
 * `GET .../roster/records/{recordId}/national-id`) and no contacts (a person's verified contacts
 * come from `GET /internal/v1/persons/{personId}/contacts`).
 */
export const internalRosterRecordSchema = z.object({
  id: z.uuid(),
  tenant: slugSchema,
  personnelFileNumber: z.string(),
  fullName: z.string(),
  designation: z.string().nullable(),
  jobGroup: z.string().nullable(),
  reportingEntity: reportingEntityRefSchema.nullable(),
  state: rosterRecordStateSchema,
  appointmentDate: z.iso.date().nullable().meta({ description: 'Null when the roster gives none' }),
  exitDate: z.iso.date().nullable().meta({ description: 'Set while the record is exited' }),
  personId: z
    .uuid()
    .nullable()
    .meta({ description: 'The declarant the record is onboarded as; kept when it exits' }),
  ofr: ofrSchema.nullable().meta({ description: "The declarant's officer reference" }),
  onboardedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime().meta({ description: 'Last change to the record' }),
});
export type InternalRosterRecord = z.infer<typeof internalRosterRecordSchema>;

/**
 * A roster record's national ID, kept off `InternalRosterRecord`: read on its own route with a
 * scope of its own (spec 08: payroll's salary stoppage and the ICMS referral).
 */
export const rosterNationalIdSchema = z.object({
  nationalId: z.string().meta({ description: 'As the roster gives it', examples: ['27451863'] }),
});
export type RosterNationalId = z.infer<typeof rosterNationalIdSchema>;

export const internalRosterRecordPageSchema = z.object({
  items: z.array(internalRosterRecordSchema),
  nextCursor: z
    .string()
    .nullable()
    .meta({ description: 'Pass as `cursor` for the next page; null on the last page' }),
});
export type InternalRosterRecordPage = z.infer<typeof internalRosterRecordPageSchema>;
