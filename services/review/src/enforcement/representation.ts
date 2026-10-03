import { z } from 'zod';

import { proposerKindSchema } from '../determinations/representation.js';
import { assigneeSchema, officer } from '../cases/assignee.js';
import type { ActionRow, LadderRow } from './ladder-records.js';
import {
  ACTION_STATUSES,
  ACTION_STEPS,
  CLOSING_CAUSES,
  LADDER_STATUSES,
  type PayrollAcknowledgement,
  SUBJECT_KINDS,
} from './schema.js';

/**
 * Bodies of the enforcement ladder API (spec 08). They are the contract: the OpenAPI document,
 * packages/schemas/internal/review.yaml, is generated from them (`pnpm contracts`).
 */

export const actionStepSchema = z.enum(ACTION_STEPS);
export const actionStatusSchema = z.enum(ACTION_STATUSES);
const subjectKindSchema = z.enum(SUBJECT_KINDS);
const whatToDoSchema = z.enum(['file-declaration', 'respond-to-clarification']);

/** review.yaml `PayrollAck`: a payroll instruction's acknowledgement, as the gateway answered. */
export const payrollAckSchema = z.object({
  instructionReference: z.string(),
  action: z.enum(['stop_salary', 'resume_salary']),
  status: z.string(),
  payrollReference: z.string().nullable(),
  receivedAt: z.iso.datetime().nullable(),
}) satisfies z.ZodType<PayrollAcknowledgement>;

/** The declarant's response to a notice or warning, as views show it. */
const actionResponseSchema = z.object({
  text: z.string(),
  attachments: z.array(z.object({ uploadId: z.uuid(), fileName: z.string() })),
  submittedAt: z.iso.datetime(),
});

/** review.yaml `AdministrativeAction`. */
export const administrativeActionSchema = z.object({
  id: z.uuid(),
  ladderId: z.uuid(),
  step: actionStepSchema,
  status: actionStatusSchema,
  proposerKind: proposerKindSchema,
  proposer: assigneeSchema
    .nullable()
    .meta({ description: "The proposing officer; null for the system's drafts" }),
  proposedAt: z.iso.datetime(),
  approver: assigneeSchema.nullable(),
  approvedAt: z.iso.datetime().nullable(),
  declinedBy: assigneeSchema.nullable(),
  declinedAt: z.iso.datetime().nullable(),
  declineNote: z.string().nullable(),
  issuedAt: z.iso
    .datetime()
    .nullable()
    .meta({ description: 'When the letter was requested; the window runs from here' }),
  windowEndsAt: z.iso.datetime().nullable(),
  reference: z.string().nullable().meta({ description: 'ADM-<ISSUER>-<YEAR>-<seq>-<check>' }),
  letter: z.object({ documentId: z.uuid(), verificationId: z.string() }).nullable(),
  response: actionResponseSchema.nullable(),
  payrollStop: payrollAckSchema.nullable(),
  payrollResume: payrollAckSchema.nullable(),
});
export type ActionView = z.infer<typeof administrativeActionSchema>;

/** review.yaml `Ladder`. */
export const ladderSchema = z.object({
  id: z.uuid(),
  subjectKind: subjectKindSchema,
  subjectId: z.uuid(),
  subjectReference: z.string(),
  declarantName: z.string(),
  personnelFileNumber: z.string(),
  status: z.enum(LADDER_STATUSES),
  closingCause: z.enum(CLOSING_CAUSES).nullable().meta({
    description:
      'What closed the ladder: compliance (`filed`, `clarification-responded`, `clarification-resolved`) or the subject gone (`obligation-cancelled`, `clarification-withdrawn`); null while active or declined',
  }),
  currentStep: actionStepSchema.nullable(),
  steps: z.array(administrativeActionSchema),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});
export type LadderView = z.infer<typeof ladderSchema>;

/**
 * review.yaml `ActionLetterPayload`: the fields the step letters (`notice-to-comply.v1`,
 * `warning.v1`, `salary-stoppage.v1`, `disciplinary-referral.v1`) render.
 */
export const actionLetterPayloadSchema = z.object({
  declarantPersonId: z.uuid().nullable().meta({
    description:
      'Who may download the letter: the documents service checks the issue request against it; null for an officer who never onboarded. Not printed',
  }),
  declarantName: z.string(),
  personnelFileNumber: z.string(),
  commission: z.object({ name: z.string(), issuerCode: z.string() }),
  reference: z.string().meta({ description: 'ADM-<ISSUER>-<YEAR>-<seq>-<check>' }),
  step: actionStepSchema,
  stepLabel: z.string(),
  subjectKind: subjectKindSchema,
  subjectReference: z.string().meta({
    description:
      "The obligation's cycle key (`biennial:2027`) or the clarification's CLR reference",
  }),
  whatToDo: whatToDoSchema,
  issuedAt: z.iso.datetime(),
  actBy: z.iso.datetime().nullable().meta({
    description: 'By when to act; null for the disciplinary referral, which sets no deadline',
  }),
  salaryStoppedFrom: z.iso.date().nullable().meta({
    description:
      "The salary stoppage's effective date (payroll stops the salary from this day); null for other steps",
  }),
  respondUrl: z.url(),
});
export type ActionLetterPayload = z.infer<typeof actionLetterPayloadSchema>;

/** review.yaml `DeclarantNotice`. */
export const declarantNoticeSchema = z.object({
  actionId: z.uuid(),
  ladderId: z.uuid().meta({
    description: 'The ladder the step belongs to: the notices of one subject share it',
  }),
  subject: z
    .object({
      kind: subjectKindSchema,
      reference: z.string().meta({
        description:
          "The obligation's cycle key (`biennial:2027`) or the clarification's CLR reference",
      }),
      dueAt: z.iso.datetime().nullable().meta({
        description:
          "When the clarification's response was due; null for an obligation (its due date is the declarations service's)",
      }),
    })
    .meta({ description: 'What the declarant failed to do, as the letter names it' }),
  windowDays: z.number().int().min(1).nullable().meta({
    description:
      'Days the step gives the declarant to act, from issue to `actBy`; null for a step without a deadline',
  }),
  commission: z.object({ slug: z.string(), name: z.string() }),
  step: actionStepSchema,
  status: actionStatusSchema,
  issuedAt: z.iso.datetime(),
  actBy: z.iso.datetime().nullable(),
  whatToDo: whatToDoSchema,
  reference: z.string(),
  letterDownloadUrl: z.url().nullable(),
  response: actionResponseSchema.nullable(),
  salaryStoppedAt: z.iso.datetime().nullable(),
  salaryReinstatedAt: z.iso.datetime().nullable(),
});
export type DeclarantNoticeView = z.infer<typeof declarantNoticeSchema>;

export function actionView(row: ActionRow): ActionView {
  return {
    id: row.id,
    ladderId: row.ladderId,
    step: row.step,
    status: row.status,
    proposerKind: row.proposerKind,
    proposer: officer(row.proposer, row.proposerName),
    proposedAt: row.proposedAt.toISOString(),
    approver: officer(row.approver, row.approverName),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    declinedBy: officer(row.declinedBy, row.declinedByName),
    declinedAt: row.declinedAt?.toISOString() ?? null,
    declineNote: row.declineNote,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    windowEndsAt: row.windowEndsAt?.toISOString() ?? null,
    reference: row.reference,
    letter:
      row.letterDocumentId !== null && row.letterVerificationId !== null
        ? { documentId: row.letterDocumentId, verificationId: row.letterVerificationId }
        : null,
    response: responseView(row),
    payrollStop: row.payrollStopAck,
    payrollResume: row.payrollResumeAck,
  };
}

/** The declarant's response as views show it: text, attachments by name, when. */
export function responseView(row: ActionRow): ActionView['response'] {
  if (row.response === null) return null;
  return {
    text: row.response.text,
    attachments: row.response.attachments.map(({ uploadId, fileName }) => ({ uploadId, fileName })),
    submittedAt: row.response.submittedAt,
  };
}

/** The ladder with its steps in ladder order: by run, then step, then when drafted. */
export function ladderView(ladder: LadderRow, actions: readonly ActionRow[]): LadderView {
  const steps = [...actions].sort(
    (a, b) =>
      a.run - b.run ||
      ACTION_STEPS.indexOf(a.step) - ACTION_STEPS.indexOf(b.step) ||
      a.proposedAt.getTime() - b.proposedAt.getTime(),
  );
  const current = steps.find((action) => action.id === ladder.currentActionId) ?? steps.at(-1);
  return {
    id: ladder.id,
    subjectKind: ladder.subjectKind,
    subjectId: ladder.subjectId,
    subjectReference: ladder.subjectReference,
    declarantName: ladder.declarantName,
    personnelFileNumber: ladder.personnelFileNumber,
    status: ladder.status,
    closingCause: ladder.closingCause,
    currentStep: current?.step ?? null,
    steps: steps.map(actionView),
    startedAt: ladder.startedAt.toISOString(),
    endedAt: ladder.endedAt?.toISOString() ?? null,
  };
}
